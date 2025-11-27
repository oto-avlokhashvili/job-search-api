import { Inject, Injectable } from "@nestjs/common";import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import jwtConfig from "../config/jwt.config";
import refreshJwtConfig from "../config/refresh-jwt-config";
import { AuthJwtPayload } from "../types/auth-jwtPayload";
import type { ConfigType } from '@nestjs/config';
@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy, "refresh-jwt"){
    constructor(@Inject(refreshJwtConfig.KEY) private refreshJwtConfiguration: ConfigType<typeof refreshJwtConfig>){
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: refreshJwtConfiguration.secret ?? '',
            ignoreExpiration:false,
        })
    }
    validate(payload:AuthJwtPayload){
        return {id:payload.sub}
    }
}