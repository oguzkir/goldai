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
        systemInstruction = "Sen bir finansal veri botusun. Sadece geçerli bir JSON objesi döndür. Asla markdown ```json``` etiketi kullanma, sadece saf JSON ver.";
        userPrompt = `
      GÖREV: Google Arama ile şu anki güncel fiyatları bul:
      1. Gram Altın (TRY)
      2. Ons Altın (USD)
      3. Gümüş (Ons/USD)
      4. Bitcoin (BTC/USD)
      5. Brent Petrol (USD)
      6. USD/TRY
      7. EUR/TRY
      8. İsviçre Frangı (CHF/TRY)

      ÇIKTI FORMATI (SAF JSON):
      {
        "prices": [
          {"name": "Gram Altın", "price": "3,000 ₺", "change": "+0.5%"},
          ... diğerleri
        ]
      }
    `;
    }

    // --- MOD 2: ANALİZ ---
    else if (mode === 'analysis') {
        const selectedAsset = asset || "Genel Piyasa";
        systemInstruction = "Sen kıdemli bir piyasa analistisin. Çıktı formatın daima geçerli bir JSON objesi olmalı. Asla markdown etiketi kullanma.";

        userPrompt = `
      "${selectedAsset}" için detaylı bir analiz yap.
      
      1. Canlı verileri ve haberleri Google'dan bul.
      2. Tarihsel benzerlik kur (1980, 2008 vb.).
      3. Tahmin yap.

      ÇIKTI FORMATI (SAF JSON):
      {
        "report_markdown": "## Rapor Başlığı\\n\\nBuraya markdown formatında rapor içeriği...",
        "verdict": "AL",
        "risk_level": "Yüksek",
        "confidence": 85
      }
    `;
    } else {
        return res.status(400).json({ error: 'Geçersiz mod.' });
    }

    try {
        // Model URL
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ google_search: {} }], // Arama Aktif
                // DİKKAT: JSON Modu Kaldırıldı (Çakışmayı önlemek için)
                // generationConfig: { responseMimeType: "application/json" } <-- SİLİNDİ
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();

        // --- MANUEL JSON TEMİZLİK VE PARSE İŞLEMİ ---
        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) throw new Error("AI boş yanıt döndürdü.");

        // AI bazen ```json ... ``` içinde veriyor, bazen düz veriyor.
        // Regex ile sadece ilk { ile son } arasını alarak temizliyoruz.
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            rawText = jsonMatch[0];
        }

        let parsedResult;
        try {
            parsedResult = JSON.parse(rawText);
        } catch (e) {
            console.error("JSON Parse Hatası:", e);
            console.log("Hatalı Metin:", rawText);
            throw new Error("AI yanıtı geçerli JSON formatında değil.");
        }

        // Kaynakları al
        const sources = data.candidates?.[0]?.groundingMetadata?.groundingAttributions?.map(a => ({
            title: a.web?.title || "Web Kaynağı",
            uri: a.web?.uri
        })).filter(s => s.uri) || [];

        return res.status(200).json({ data: parsedResult, sources });

    } catch (error) {
        console.error('Handler Error:', error.message);
        return res.status(500).json({ error: 'Sunucu Hatası: ' + error.message });
    }
}