import { Inject, Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, Profile, VerifyCallback } from "passport-google-oauth20";
import googleOauthConfig from "../config/google-oauth.config";
import type { ConfigType } from "@nestjs/config";
import { AuthService } from "../auth.service";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy) {
    constructor(
        @Inject(googleOauthConfig.KEY)
        private googleConfiguration: ConfigType<typeof googleOauthConfig>,
        private authService: AuthService
    ) {
        super({
            clientID: googleConfiguration.clientId!,
            clientSecret: googleConfiguration.secret!,
            callbackURL: googleConfiguration.callbackUrl!,
            scope: ["email", "profile"],
            accessType: "offline",
            prompt: "consent",
        } as any);
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
    ) {
        try {
            const email = profile.emails?.[0]?.value;
            if (!email) throw new Error('Google profile has no email');

            // Many Google accounts have no family name (and some no given name), but both
            // columns are NOT NULL: a missing one used to make sign-up fail.
            const firstName = profile.name?.givenName || profile.displayName || email.split('@')[0];
            const lastName = profile.name?.familyName || '';

            const user = await this.authService.validateGoogleUser({ email, firstName, lastName, password: "" });
            done(null, user);
        } catch (err) {
            done(err as Error);
        }
    }
}
