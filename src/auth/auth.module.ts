import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserService } from 'src/user/user.service';
import { LocalStrategy } from './strategies/local.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/Entities/user.entity';
import { JwtModule } from '@nestjs/jwt'
import jwtConfig from './config/jwt.config';
@Module({
  imports: [TypeOrmModule.forFeature([User]),
    JwtModule.register({
      secret:process.env.JWT_SECRET,
      signOptions:{
        expiresIn: "1d"
      }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, UserService, LocalStrategy],
})
export class AuthModule { }
