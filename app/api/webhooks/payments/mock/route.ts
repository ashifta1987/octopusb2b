import { problem } from '@/lib/api/problem';
import { handleProviderWebhook } from '../shared';

export async function POST(req: Request) {
  if (process.env.APP_ENVIRONMENT !== 'staging') {
    return problem(404, 'NOT_FOUND', 'Not found.');
  }
  return handleProviderWebhook(req, 'mock');
}
