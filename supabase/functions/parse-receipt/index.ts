// Supabase Edge Function: parse-receipt
//
// Receives a receipt photo (base64) from the app and asks Claude to read it,
// returning structured JSON the app can use to pre-fill the "新增採購紀錄" form.
// The user still has to review and confirm before it's saved — this only fills
// in a best guess.
//
// Deploy with:
//   supabase functions deploy parse-receipt --project-ref <your-project-ref>
// Set the Anthropic API key as a secret first:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <your-project-ref>

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORY_IDS = [
  "veg", "meat", "staple", "drink", "pantry",
  "household", "personal", "kitchen", "medicine", "takeaway", "other",
];

const SYSTEM_PROMPT = `你是收據辨識助手。使用者會給你一張超市/商店收據的照片，請仔細閱讀後只回覆一個 JSON 物件（不要有任何其他文字、不要用 markdown code block），格式如下：

{"title": "商店名稱或簡短描述", "amount": 12.34, "date": "YYYY-MM-DD 或 null", "category": "以下其中一個: ${CATEGORY_IDS.join("|")}"}

規則：
- amount 一定要是收據上的「總金額」數字（不含貨幣符號），看不清楚就填 null。
- date 如果收據上有清楚的日期就轉換成 YYYY-MM-DD，看不到就填 null，不要用今天的日期猜測。
- category 根據收據上的品項內容判斷最接近的一個分類；如果無法判斷就填 "other"。
- title 用商店名稱（例如 "Tesco"、"Waitrose"），如果看不到店名就用最主要的品項簡短描述。
- 只回覆 JSON，不要加任何說明文字。`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { imageBase64, mediaType } = await req.json();

    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: "缺少 imageBase64 或 mediaType" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              { type: "text", text: "請閱讀這張收據並回覆 JSON。" },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API 錯誤: ${errText}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await anthropicRes.json();
    const text: string = data?.content?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: "無法從辨識結果解析出 JSON", raw: text }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return new Response(JSON.stringify({ error: "辨識結果不是有效的 JSON", raw: text }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const result = {
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 100) : null,
      amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      category: CATEGORY_IDS.includes(String(parsed.category)) ? parsed.category : "other",
    };

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
