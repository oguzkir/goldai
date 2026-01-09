export default async function handler(req, res) {
    // 1. Sadece POST isteklerini kabul et
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. API Anahtarını Vercel Environment Variables'dan al
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("API Key eksik!");
        return res.status(500).json({ error: 'Server API Key eksik. Vercel ayarlarını kontrol edin.' });
    }

    const { mode, asset } = req.body;

    let systemInstruction = "";
    let userPrompt = "";

    // --- SENARYO 1: CANLI FİYAT BANDI (TICKER) ---
    if (mode === 'ticker') {
        systemInstruction = "Sen bir finansal veri asistanısın. Görevin sadece en güncel piyasa fiyatlarını JSON formatında sunmaktır. Asla yorum yapma.";
        userPrompt = `
      GÖREV: Google Arama aracını kullanarak şu varlıkların ŞU ANKİ (Canlı/Son kapanış) fiyatlarını ve günlük yüzde değişimlerini bul:
      1. Gram Altın (TRY)
      2. Ons Altın (USD)
      3. Gümüş (Ons/USD)
      4. Bitcoin (BTC/USD)
      5. Brent Petrol (USD)
      6. USD/TRY
      7. EUR/TRY
      8. İsviçre Frangı (CHF/TRY)

      ÇIKTI FORMATI: Sadece aşağıdaki JSON formatında veri döndür. Markdown 'json' etiketi kullanma.
      {
        "prices": [
          {"name": "Gram Altın", "price": "3,000 ₺", "change": "+0.5%"},
          {"name": "Ons Altın", "price": "$2,650", "change": "-0.2%"},
          ... diğerleri
        ]
      }
    `;
    }

    // --- SENARYO 2: DETAYLI VARLIK ANALİZİ & TAHMİN ---
    else if (mode === 'analysis') {
        const selectedAsset = asset || "Genel Piyasa";

        systemInstruction = `
      KİMLİK: Sen 50 yıllık deneyime sahip, "Wall Street Tarihçisi" lakaplı kıdemli bir stratejistsin.
      
      YETENEK: Bugünü analiz ederken asla sadece bugüne bakmazsın. Daima 1970'ler stagflasyonu, 1980 altın zirvesi, 2000 teknoloji balonu veya 2008 krizi gibi dönemlerle "Fraktal Karşılaştırma" yaparsın.
      
      GÖREV: Kullanıcının sorduğu varlık için (${selectedAsset}) analiz yap. Türkçe konuş.
    `;

        userPrompt = `
      Lütfen "${selectedAsset}" için detaylı bir stratejik rapor hazırla.
      
      ADIM 1 (Canlı Veri): ${selectedAsset} güncel fiyatını, teknik göstergelerini (RSI, Hareketli Ortalamalar) ve son 24 saatteki en kritik haberleri Google'dan bul.
      
      ADIM 2 (Tarihsel Kıyas): Şu anki grafik yapısı veya makroekonomik koşullar (Enflasyon, Savaş vb.) geçmişteki hangi yıla benziyor? Neden?
      
      ADIM 3 (Tahmin): Tarihsel benzerliğe dayanarak önümüzdeki 3-6 ay için projeksiyonun nedir?

      ÇIKTI FORMATI (JSON):
      {
        "report_markdown": "## ${selectedAsset} Stratejik Raporu... (Markdown formatında detaylı analiz yazısı)",
        "verdict": "AL", 
        "risk_level": "Yüksek",
        "confidence": 85
      }
      Not: "verdict" sadece şunlardan biri olabilir: "GÜÇLÜ AL", "AL", "NÖTR", "SAT", "GÜÇLÜ SAT".
    `;
    } else {
        return res.status(400).json({ error: 'Geçersiz mod.' });
    }

    try {
        // Gemini 2.5 Flash Modelini (Search Grounding destekli) kullanıyoruz
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ google_search: {} }], // Google Grounding Aktif
                generationConfig: { responseMimeType: "application/json" } // JSON çıktısı zorunlu
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Gemini API Error:", errText);
            throw new Error(`Gemini API Error: ${response.status}`);
        }

        const data = await response.json();

        // Güvenli JSON parse işlemi
        let parsedResult;
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
            throw new Error("AI boş yanıt döndürdü.");
        }

        try {
            parsedResult = JSON.parse(rawText);
        } catch (e) {
            // AI bazen markdown bloğu ```json ... ``` içinde verir, temizleyelim
            const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedResult = JSON.parse(cleanText);
        }

        // Kaynakları ayıkla
        const sources = data.candidates?.[0]?.groundingMetadata?.groundingAttributions?.map(a => ({
            title: a.web?.title || "Web Kaynağı",
            uri: a.web?.uri
        })).filter(s => s.uri) || [];

        return res.status(200).json({ data: parsedResult, sources });

    } catch (error) {
        console.error('API Handler Error:', error);
        return res.status(500).json({ error: 'Analiz sırasında sunucu hatası: ' + error.message });
    }
}