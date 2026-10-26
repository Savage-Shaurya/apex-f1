import { getNewsletterRecovery } from '@/lib/newsletter-recovery-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(req: Request, context: { params: Promise<{ editionKey: string }> }) {
  return getNewsletterRecovery(req, (await context.params).editionKey);
}
