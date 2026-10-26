import { Controller, Get, Post, Body, Patch, Param, UseGuards, Request, ParseIntPipe, BadRequestException, ForbiddenException, Query, ParseBoolPipe } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateHrUserDto } from './dto/create-hr-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { HrApprovalDto } from './dto/hr-approval.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/enums/user-role.enum';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }
  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.userService.create(createUserDto);
    return this.userService.findOne(user.id);
  }

  @Post('hr')
  @ApiOperation({ summary: 'Register an HR account (needs email verification and admin approval)' })
  createHr(@Body() dto: CreateHrUserDto) {
    return this.userService.createHr(dto);
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('all')
  findAll() {
    return this.userService.findAll();
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('hr')
  @ApiOperation({ summary: 'Admin: list HR accounts (approved=false for the pending queue)' })
  @ApiQuery({ name: 'approved', required: false, type: Boolean })
  findHrUsers(@Query('approved', new ParseBoolPipe({ optional: true })) approved?: boolean) {
    return this.userService.findHrUsers(approved);
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('hr/:id/approval')
  @ApiOperation({ summary: 'Admin: approve or revoke an HR account' })
  setHrApproval(@Param('id', ParseIntPipe) id: number, @Body() dto: HrApprovalDto) {
    return this.userService.setHrApproval(id, dto.approved);
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() updateUserDto: UpdateUserDto) {
    if (req.user.id !== id && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only update your own profile.');
    }
    return this.userService.update(id, updateUserDto);
  }
}
