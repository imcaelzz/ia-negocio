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

Escreva somente a mensagem pronta para envio, sem título, explicações, aspas ou formatação Markdown. Seja claro, natural e breve. Não invente preço, prazo, desconto, nome ou condição que não tenha sido informada. Inclua uma chamada para ação adequada ao objetivo.`;

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
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
      },
    );

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

    return json({ message });
  } catch (error) {
    console.error('Falha ao gerar mensagem:', error instanceof Error ? error.message : 'erro desconhecido');
    return json({ error: 'Não foi possível gerar a mensagem agora.' }, 500);
  }
};

export const config = {
  path: '/api/generate-message',
  method: 'POST',
};
