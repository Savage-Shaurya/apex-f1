import { postNewsletterRecovery } from '@/lib/newsletter-recovery-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request, context: { params: Promise<{ editionKey: string }> }) {
  return postNewsletterRecovery(req, (await context.params).editionKey);
}
