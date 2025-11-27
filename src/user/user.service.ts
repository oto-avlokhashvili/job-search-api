import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { create } from 'domain';
import { remove } from 'node_modules/cheerio/dist/commonjs/api/manipulation';
import { JobEntity } from 'src/Entities/job.entity';
import { Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';

@Injectable()
export class UserService {
  constructor(@InjectRepository(User) private userRepo: Repository<User>) { }

  async create(createUserDto: CreateUserDto) {
    const user = await this.userRepo.create(createUserDto)
    return await this.userRepo.save(user);
  }

  async findAll() {
    const users = await this.userRepo.find()
    return users;
  }

  async findOne(id: number) {
    return await this.userRepo.findOne({
      where: {
        id,
      },
      select: ['id', 'firstName', 'lastName', 'email', 'createdAt']
    })
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
  async findByEmail(email: string) {
    return await this.userRepo.findOne({
      where: {
        email,
      },
    })
  }
}
