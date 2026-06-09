import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify user email using the 6-digit code' })
  async verifyEmail(
    @Body('email') email: string,
    @Body('code') code: string,
  ) {
    const success = await this.userService.verifyEmail(email, code);
    if (!success) {
      throw new BadRequestException('Invalid verification code or email');
    }
    return { success: true, message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend verification code to user email' })
  async resendVerification(@Body('email') email: string) {
    return await this.userService.resendVerification(email);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get('all')
  findAll() {
    return this.userService.findAll();
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(+id);
  }
  // user.controller.ts

  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(+id, updateUserDto);
  }

  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Delete()
  hardDelete() {
    return this.userService.remove();
  }
}
