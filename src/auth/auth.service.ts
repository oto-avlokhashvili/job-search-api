import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { compare } from 'bcrypt'
import { JwtService } from '@nestjs/jwt';
import { AuthJwtPayload } from './types/auth-jwtPayload';
import type { ConfigType } from '@nestjs/config';
import refreshJwtConfig from './config/refresh-jwt-config';

@Injectable()
export class AuthService {
    constructor(private userService: UserService, private jwtService:JwtService, @Inject(refreshJwtConfig.KEY) private refreshTokenConfig: ConfigType<typeof refreshJwtConfig> ){}
    async validateUser(email:string, password:string){
        const user = await this.userService.findByEmail(email);
        if(!user) throw new UnauthorizedException("user not found");
        const isPasswordMatch = await compare(password, user.password);
        if(!isPasswordMatch) throw new UnauthorizedException("Invalid Credentials")

        return {id:user.id};
    }


    login(userId:number){
        const payload: AuthJwtPayload = {sub: userId}
        const token = this.jwtService.sign(payload);
        const refreshToken = this.jwtService.sign(payload, this.refreshTokenConfig)
        return ({
            id: userId,
            token,
            refreshToken
        })
    }

    refreshToken(userId:number){
        const payload:AuthJwtPayload = {sub:userId}
        const token = this.jwtService.sign(payload)
        return ({
            id:userId,
            token
        })
    }

    async validateJwtUser(userId:number){
        const user = await this.userService.findOne(userId)
        if(!user) throw new UnauthorizedException();
            const currentUser = user;            
        return currentUser;
    }
}
