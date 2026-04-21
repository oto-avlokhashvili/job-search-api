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
        });
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
    ) {
        console.log({ profile });
        const user = await this.authService.validateGoogleUser({
            email: profile.emails![0].value,
            firstName: profile.name!.givenName,
            lastName: profile.name!.familyName,
            password: "",
        });
        done(null, user);
    }
}
