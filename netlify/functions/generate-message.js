

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

   const prompt = `Crie uma mensagem de WhatsApp em português do Brasil para um pequeno negócio.

Produto ou serviço: ${business}
Público: ${customer || 'não informado'}
Objetivo: ${goal}
Tom: ${tone}
Detalhes extras: ${details || 'nenhum'}

Responda SOMENTE com um objeto JSON válido, sem Markdown e sem texto antes ou depois.

O JSON deve ter exatamente estes três campos:
{
  "opening": "primeira frase da mensagem",
  "details": "detalhes da oferta ou mensagem",
  "cta": "chamada para ação"
}

Regras:

1. O campo "opening" deve começar diretamente com o produto, serviço, oferta, preço, desconto ou principal benefício informado pelo usuário.
2. Se o objetivo for "Divulgar uma oferta", o campo "opening" NÃO pode começar com "Oi", "Olá", "Tudo bem?", "Cansado de", "Sabe aquela" ou qualquer saudação, pergunta ou introdução.
3. Para "Divulgar uma oferta", o campo "opening" deve apresentar a oferta diretamente. Exemplo: "Combo com 5 marmitas por R$ 59,90, com entrega grátis hoje."
4. O campo "details" deve conter somente informações fornecidas pelo usuário, como prazo, condições, características, preço ou desconto.
5. O campo "cta" deve terminar a mensagem com uma chamada para ação clara e natural.
6. Não invente informações.
7. Não use placeholders como [Nome], [Nome do Cliente], {{nome}} ou <nome>.
8. Escreva em português do Brasil, de forma natural, breve e fácil de ler no WhatsApp.
9. Não use título, explicações ou Markdown.
10. Preserve exatamente preços, descontos, prazos e condições fornecidos pelo usuário.`;
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

const rawMessage = data.candidates?.[0]?.content?.parts
  ?.map((part) => part.text || '')
  .join('')
  .trim();

let message = '';

try {
  const parsed = JSON.parse(rawMessage);

  const opening = `${business}: ${details || 'Confira nossa oferta de hoje.'}`;

  message = [opening, parsed.details, parsed.cta]
    .filter(Boolean)
    .join(' ')
    .trim();
} catch {
  message = rawMessage;
}

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

  if (priceMatch && priceMatch.index !== undefined) {
    const priceIndex = priceMatch.index;

    const sentenceStart = Math.max(
      cleaned.lastIndexOf('.', priceIndex),
      cleaned.lastIndexOf('!', priceIndex),
      cleaned.lastIndexOf('?', priceIndex)
    ) + 1;

    cleaned = cleaned.slice(sentenceStart).trim();
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
