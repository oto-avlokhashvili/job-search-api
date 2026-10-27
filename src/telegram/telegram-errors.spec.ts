import { isPermanentTelegramError } from './telegram.service';

// Shape of node-telegram-bot-api errors
const telegramError = (status: number, description: string) => ({
  code: 'ETELEGRAM',
  message: `ETELEGRAM: ${status} ${description}`,
  response: { statusCode: status, body: { ok: false, error_code: status, description } },
});

describe('isPermanentTelegramError', () => {
  it('treats an unreachable chat as permanent', () => {
    expect(isPermanentTelegramError(telegramError(400, 'Bad Request: chat not found'))).toBe(true);
  });

  it('treats a blocked bot or deactivated user (403) as permanent', () => {
    expect(isPermanentTelegramError(telegramError(403, 'Forbidden: bot was blocked by the user'))).toBe(true);
    expect(isPermanentTelegramError(telegramError(403, 'Forbidden: user is deactivated'))).toBe(true);
  });

  it('retries rate limits, other bad requests and network errors', () => {
    expect(isPermanentTelegramError(telegramError(429, 'Too Many Requests: retry after 5'))).toBe(false);
    expect(isPermanentTelegramError(telegramError(400, "Bad Request: can't parse entities"))).toBe(false);
    expect(isPermanentTelegramError({ code: 'EFATAL', message: 'read ECONNRESET' })).toBe(false);
  });
});
