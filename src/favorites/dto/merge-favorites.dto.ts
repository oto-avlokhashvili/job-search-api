import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsPositive } from 'class-validator';
import { MAX_FAVORITES_PER_REQUEST } from '../favorites.service';

export class MergeFavoritesDto {
    @ApiProperty({ type: [Number], description: 'Job ids saved in the browser before signing in' })
    @IsArray()
    @ArrayMaxSize(MAX_FAVORITES_PER_REQUEST)
    @IsInt({ each: true })
    @IsPositive({ each: true })
    jobIds: number[];
}
