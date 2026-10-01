

const json = (body, status = 200) => Response.json(body, { status });

const labels = {
  goals: {
    offer: 'Divulgar uma oferta',
    first: 'Abordar um novo cliente',
    follow: 'Retomar contato',
    recover: 'Recuperar um cliente',
    thanks: 'Agradecer uma compra',
  },
  tones: {
    friendly: 'Amigável',
    professional: 'Profissional',
    persuasive: 'Persuasivo, sem exageros',
    casual: 'Descontraído',
  },
};

const safeText = (value, maxLength) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('GEMINI_API_KEY não está configurada.');
    return json({ error: 'Não foi possível gerar a mensagem agora.' }, 503);
  }

  try {
    const body = await request.json();
    const business = safeText(body.business, 200);
    const customer = safeText(body.customer, 200);
    const details = safeText(body.details, 1000);
    const goal = labels.goals[body.goal];
    const tone = labels.tones[body.tone];

    if (!business || !goal || !tone) {
      return json({ error: 'Preencha os campos obrigatórios.' }, 400);
    }

    const prompt = `Crie uma única mensagem de WhatsApp em português do Brasil para um pequeno negócio.

Produto ou serviço: ${business}
Público: ${customer || 'não informado'}
Objetivo: ${goal}
Tom: ${tone}
Detalhes extras: ${details || 'nenhum'}

Escreva somente a mensagem pronta para envio, em português do Brasil, sem título, explicações, aspas ou formatação Markdown.

Seja claro, natural, breve e persuasivo sem exageros. Escreva como uma pessoa que realmente conversa com clientes pelo WhatsApp.

Quando o objetivo for "Divulgar uma oferta", escreva a mensagem começando diretamente pelo produto, oferta, preço, desconto ou principal benefício informado pelo usuário. A primeira frase deve ser uma frase comercial direta e objetiva. NÃO faça saudação, apresentação, pergunta, contexto, história ou introdução antes da oferta. NÃO comece com "Oi", "Olá", "Oi, tudo bem?", "Tudo bem?", "Cansado de...", "Sabe aquela..." ou perguntas retóricas. Depois da primeira frase, apresente os detalhes importantes da oferta, como preço, desconto, prazo ou condição, e finalize com uma chamada para ação clara. Não repita a oferta e não invente informações.

Use frases curtas e fáceis de ler no celular. Evite repetir informações. Use emojis somente quando combinarem com o contexto e com moderação.

Preserve exatamente os dados fornecidos pelo usuário, incluindo preços, descontos, prazos, condições e características do produto ou serviço. Não invente nenhuma informação.

Inclua uma chamada para ação clara e natural, adequada ao objetivo da mensagem.

A resposta NUNCA deve conter placeholders como [Nome do Cliente], [nome], {{nome}}, <nome> ou qualquer marcador semelhante. Entregue uma mensagem final, pronta para copiar e enviar ao cliente, sem campos que precisem ser preenchidos manualmente.

Quando uma informação não tiver sido fornecida, omita-a ou use uma expressão genérica natural, sem inventar dados nem pedir substituições.`;

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 500 },
      }),
      signal: AbortSignal.timeout(25000),
    };
    let geminiResponse;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
        requestOptions,
      );

      if (geminiResponse.status !== 503 || attempt === 1) {
        break;
      }

      await geminiResponse.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!geminiResponse.ok) {
      console.error(`A API Gemini respondeu com status ${geminiResponse.status}.`);
      return json({ error: 'Não foi possível gerar a mensagem agora.' }, 502);
    }

    const data = await geminiResponse.json();
    const message = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();

    if (!message) {
      console.error('A API Gemini não retornou texto.');
      return json({ error: 'Não foi possível gerar a mensagem agora.' }, 502);
    }

    const cleanMessage = (() => {
  let cleaned = message
    .replaceAll('[Nome do Cliente]', '')
    .replaceAll('[nome do cliente]', '')
    .replaceAll('[Nome]', '')
    .replaceAll('[nome]', '')
    .replaceAll('{{Nome}}', '')
    .replaceAll('{{nome}}', '')
    .replaceAll('<Nome>', '')
    .replaceAll('<nome>', '')
    .replace(/\s+/g, ' ')
    .trim();

  const priceMatch = cleaned.match(/R\$\s*[\d.,]+/i);

  if (priceMatch) {
    const priceIndex = priceMatch.index;
    const offerStart = cleaned.lastIndexOf('.', priceIndex) + 1;
    const exclamationStart = cleaned.lastIndexOf('!', priceIndex) + 1;
    const questionStart = cleaned.lastIndexOf('?', priceIndex) + 1;

    const start = Math.max(
      offerStart,
      exclamationStart,
      questionStart
    );

    cleaned = cleaned.slice(start).trim();
  }

  return cleaned;
})();
return json({ message: cleanMessage });
  } catch (error) {
    console.error('Falha ao gerar mensagem:', error instanceof Error ? error.message : 'erro desconhecido');
    return json({ error: 'Não foi possível gerar a mensagem agora.' }, 500);
  }
};

export const config = {
  path: '/api/generate-message',
  method: 'POST',
};
