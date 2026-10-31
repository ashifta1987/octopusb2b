import 'server-only';
import OpenAI from 'openai';

/** AiAdapter (SPEC §7): SEO fix, description, poster copy, photo enhance. OpenAI when OPENAI_API_KEY is set, mock otherwise. */
export interface AiAdapter {
  readonly mode: 'live' | 'mock';
  seoFix(p: ProductInput): Promise<{ seo_title: string; seo_description: string; title?: string }>;
  describe(p: ProductInput): Promise<{ description: string }>;
  poster(p: ProductInput): Promise<{ headline: string; tagline: string; bullets: string[]; image_url?: string }>;
  enhancePhoto(imageUrl: string, p: ProductInput): Promise<{ image_url: string; note: string }>;
}
export type ProductInput = { title: string; description?: string | null; category?: string | null; specs?: Record<string, string>; moq?: number; unit?: string };

class OpenAiAdapter implements AiAdapter {
  readonly mode = 'live' as const;
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  private model = process.env.AI_MODEL || 'gpt-4o-mini';

  private async json<T>(system: string, user: string): Promise<T> {
    const r = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return JSON.parse(r.choices[0]?.message?.content ?? '{}') as T;
  }
  seoFix(p: ProductInput) {
    return this.json<{ seo_title: string; seo_description: string; title?: string }>(
      'You are an SEO editor for a B2B industrial-supplies marketplace (Octopus B2B). Return JSON {"title","seo_title","seo_description"}. title: clean product title ≤ 90 chars with key spec. seo_title ≤ 60 chars, include "Wholesale". seo_description 140–155 chars, mention MOQ and USD tier pricing. Never mention supplier names.',
      JSON.stringify(p),
    );
  }
  describe(p: ProductInput) {
    return this.json<{ description: string }>(
      'Write a factual B2B product description (90–140 words, plain text, 2 short paragraphs) for a wholesale marketplace. No supplier names, no invented certifications. Return JSON {"description"}.',
      JSON.stringify(p),
    );
  }
  poster(p: ProductInput) {
    return this.json<{ headline: string; tagline: string; bullets: string[] }>(
      'Create marketing poster copy for a B2B product. Return JSON {"headline" (≤ 6 words), "tagline" (≤ 12 words), "bullets" (3 items, ≤ 6 words each)}.',
      JSON.stringify(p),
    );
  }
  async enhancePhoto(imageUrl: string, p: ProductInput) {
    // Image editing via gpt-image-1 needs the source bytes; generate a clean studio packshot from the product description instead.
    try {
      const img = await this.client.images.generate({
        model: 'gpt-image-1', size: '1024x1024',
        prompt: `Clean e-commerce studio packshot on pure white background, soft shadow, of: ${p.title}. No text, no logos.`,
      });
      const b64 = img.data?.[0]?.b64_json;
      return { image_url: b64 ? `data:image/png;base64,${b64}` : imageUrl, note: 'Generated studio packshot (review before publishing).' };
    } catch (e) {
      return { image_url: imageUrl, note: `Image model unavailable: ${(e as Error).message}` };
    }
  }
}

class MockAiAdapter implements AiAdapter {
  readonly mode = 'mock' as const;
  async seoFix(p: ProductInput) {
    const t = p.title.replace(/\s+/g, ' ').trim();
    return {
      title: t.charAt(0).toUpperCase() + t.slice(1),
      seo_title: `${t.slice(0, 45)} | Wholesale`.slice(0, 60),
      seo_description: `Buy ${t} wholesale with tiered USD pricing${p.moq ? `, MOQ ${p.moq} ${p.unit ?? 'pcs'}` : ''}. Verified suppliers, RFQ in minutes, tracked delivery.`.slice(0, 155),
    };
  }
  async describe(p: ProductInput) {
    return { description: `${p.title} for wholesale buyers. Supplied with tiered USD pricing and quality checks before shipment.\n\nRequest a quote for custom quantities, packaging or certification documents. Samples and QC inspection available through Octopus B2B.` };
  }
  async poster(p: ProductInput) {
    return { headline: p.title.split(',')[0].slice(0, 40), tagline: 'Factory-direct pricing, shipped worldwide', bullets: ['Tiered USD pricing', 'QC before shipment', 'Tracked delivery'] };
  }
  async enhancePhoto(imageUrl: string) {
    return { image_url: imageUrl, note: 'Mock mode: set OPENAI_API_KEY to enable AI photo tools.' };
  }
}

export function getAiAdapter(): AiAdapter {
  return process.env.OPENAI_API_KEY ? new OpenAiAdapter() : new MockAiAdapter();
}
