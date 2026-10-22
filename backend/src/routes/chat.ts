import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Repository } from '../repositories/types';
import { ApiError, notConfigured } from '../lib/errors';
import { buildChatSystemPrompt, resolveCartActions, type ChatMessage, type ChatService } from '../lib/chat';
import { validateBody } from '../middleware/validate';

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1, 'Message cannot be empty').max(1000, 'Message is too long'),
      })
    )
    .min(1, 'At least one message is required')
    .max(20, 'Conversation is too long'),
});

export function chatRouter(deps: { repo: Repository | null; chat: ChatService | null; rateLimitMax?: number }) {
  const router = Router();
  // Stricter than the global limiter: every message spends API money.
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: deps.rateLimitMax ?? 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'You are sending messages too quickly — please wait a few minutes.' },
  });

  router.post('/chat', limiter, validateBody(chatBodySchema), async (req, res, next) => {
    try {
      if (!deps.chat) throw new ApiError(503, 'Ember AI is not available right now.');
      if (!deps.repo) throw notConfigured();
      const { messages } = req.body as { messages: ChatMessage[] };
      if (messages[messages.length - 1].role !== 'user') {
        throw new ApiError(400, 'The last message must be from the user.');
      }
      // Client-supplied history is untrusted: a visitor can put anything
      // in an "assistant" message — including forged [[ADD: …]] markers
      // or claims that a discount was approved. Strip every [[...]] span
      // before the history reaches the model; markers are only ever
      // honoured in the model's OWN reply (resolveCartActions reads the
      // reply text, never the history). Messages left empty by stripping
      // drop out, and the slice bounds what reaches the model even if
      // the schema cap above is ever relaxed.
      const cleanMessages = messages
        .map((m) => ({ role: m.role, content: m.content.replace(/\[\[[^\]]*\]\]/g, '').trim() }))
        .filter((m) => m.content.length > 0)
        .slice(-20);
      if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== 'user') {
        throw new ApiError(400, 'The last message must be from the user.');
      }
      const [settings, items] = await Promise.all([deps.repo.getSettings(), deps.repo.listMenuItems()]);
      const raw = await deps.chat.reply({ system: buildChatSystemPrompt(settings, items), messages: cleanMessages });
      const { text, actions } = resolveCartActions(raw, items);
      const reply = text || (actions.length
        ? `Added to your cart: ${actions.map((a) => `${a.quantity} × ${a.name}`).join(', ')}. Open the cart to review and check out whenever you are ready.`
        : 'Sorry, I did not quite catch that — could you rephrase?');
      res.json({ reply, actions });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
