import { Controller, Post, UseGuards, Request, HttpStatus, HttpCode, Get, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshAuthGuard } from './guards/refresh-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  /* @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post("login")
  async login(@Request() req){
    return req.user;
  } */

  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post("login")
  async login(@Request() req){
    this.authService.login(req.user.id)
    return this.authService.login(req.user.id)
  }

  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  refreshToken(@Req() req){
    return this.authService.refreshToken(req.user.id)
  }
  
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
