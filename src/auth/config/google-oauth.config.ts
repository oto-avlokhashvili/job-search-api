import { registerAs } from '@nestjs/config';

export default registerAs("googleOauth", () => ({
    clientId: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL
}));