export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("API Key eksik!");
        return res.status(500).json({ error: 'Server API Key eksik.' });
    }

    const { mode, asset } = req.body;

    let systemInstruction = "";
    let userPrompt = "";

    // --- MOD 1: TICKER ---
    if (mode === 'ticker') {
        systemInstruction = "Sen bir finansal veri asistanısın. Sadece geçerli bir JSON objesi döndür. Kaynakları mutlaka ekle.";
        userPrompt = `
      GÖREV: Google Arama ile şu anki güncel fiyatları bul:
      Gram Altın (TRY), Ons Altın (USD), Gümüş (Ons/USD), Bitcoin (BTC/USD), Brent Petrol (USD), USD/TRY, EUR/TRY, İsviçre Frangı.

      ÇIKTI FORMATI (SAF JSON - ASLA MARKDOWN KULLANMA):
      {
        "prices": [
          {"name": "Gram Altın", "price": "3,000 ₺", "change": "+0.5%"},
          ...
        ],
        "sources": [
          {"title": "BloombergHT", "uri": "https://www.bloomberght.com"},
          {"title": "Investing", "uri": "https://tr.investing.com"}
        ]
      }
    `;
    }

    // --- MOD 2: ANALİZ ---
    else if (mode === 'analysis') {
        const selectedAsset = asset || "Genel Piyasa";
        systemInstruction = "Sen kıdemli bir analistsin. Çıktı formatın daima geçerli bir JSON objesi olmalı. Kaynakları JSON içine ekle.";

        userPrompt = `
      "${selectedAsset}" için detaylı bir analiz yap.
      1. Canlı verileri Google'dan bul.
      2. Tarihsel benzerlik kur.
      3. Tahmin yap.

      ÇIKTI FORMATI (SAF JSON - ASLA MARKDOWN KULLANMA):
      {
        "report_markdown": "## Rapor Başlığı\\n\\nİçerik...",
        "verdict": "AL",
        "risk_level": "Yüksek",
        "confidence": 85,
        "sources": [
           {"title": "Haber Kaynağı Adı", "uri": "https://kaynak-linki.com"}
        ]
      }
    `;
    } else {
        return res.status(400).json({ error: 'Geçersiz mod.' });
    }

    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ google_search: {} }]
                // DİKKAT: JSON Modu (responseMimeType) SİLİNDİ! Hatanın sebebi buydu.
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) throw new Error("AI boş yanıt döndürdü.");

        // JSON Temizliği
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) rawText = jsonMatch[0];

        let parsedResult;
        try {
            parsedResult = JSON.parse(rawText);
        } catch (e) {
            console.error("JSON Parse Hatası:", rawText);
            // Hata durumunda boş JSON döndür, uygulama çökmesin
            parsedResult = {
                error: "JSON Hatası",
                report_markdown: "Veri işlenirken hata oluştu. Lütfen tekrar deneyin.",
                verdict: "NÖTR",
                risk_level: "--",
                confidence: 0,
                prices: [],
                sources: []
            };
        }

        // KAYNAK BİRLEŞTİRME
        // 1. API Metadata'dan gelen kaynaklar
        const metaSources = data.candidates?.[0]?.groundingMetadata?.groundingAttributions?.map(a => ({
            title: a.web?.title || "Web Kaynağı",
            uri: a.web?.uri
        })).filter(s => s.uri) || [];

        // 2. AI'nın JSON içine yazdığı kaynaklar
        const jsonSources = parsedResult.sources || [];

        // İkisini birleştir (Çift kayıtları engelle)
        const allSources = [...metaSources, ...jsonSources].filter((v, i, a) => a.findIndex(t => (t.uri === v.uri)) === i);

        return res.status(200).json({ data: parsedResult, sources: allSources });

    } catch (error) {
        console.error('Handler Error:', error.message);
        return res.status(500).json({ error: 'Sunucu Hatası: ' + error.message });
    }
}