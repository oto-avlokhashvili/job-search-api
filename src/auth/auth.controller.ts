import { Controller, Post, UseGuards, Request, HttpStatus, HttpCode, Get, Req, Body, UnauthorizedException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshAuthGuard } from './guards/refresh-auth.guard';
import { LoginDto } from './dto/login.dto';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Public } from './decorators/public.decorator';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }
  /* @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post("login")
  async login(@Request() req){
    return req.user;
  } */

  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post("login")
  async login(@Request() req, @Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException();
    const loginData = this.authService.login(req.user.id);

    res.cookie('refreshToken', loginData.refreshToken, {
      httpOnly: true,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return {
      id: loginData.id,
      token: loginData.token
    }
  }

  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  refreshToken(@Req() req) {
    return this.authService.refreshToken(req.user.id)
  }
  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('refreshToken');
    return { message: 'Logged out successfully' };
  }


@Public()
@ApiExcludeEndpoint()
@Get('google/login')
@UseGuards(GoogleAuthGuard)
googleLogin() {}

@Public()
@ApiExcludeEndpoint()
@Get('google/callback')
@UseGuards(GoogleAuthGuard)
async googleCallback(@Req() req, @Res() res) {
  const response = await this.authService.login(req.user.id);
  res.redirect(`${process.env.FRONTEND_URL}?token=${response.token}`);
}

}
