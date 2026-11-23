import { handleProviderWebhook } from '../shared';

export async function POST(req: Request) {
  return handleProviderWebhook(req, 'airwallex');
}
