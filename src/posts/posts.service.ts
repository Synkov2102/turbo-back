import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Post, PostDocument } from '../schemas/post.schema';
import { CreatePostDto } from './dto/create-post.dto';
import { PaginatedResponse } from './interfaces/paginated-response.interface';

@Injectable()
export class PostsService {
  constructor(@InjectModel(Post.name) private postModel: Model<PostDocument>) {}

  async createPost(createPostDto: CreatePostDto): Promise<Post> {
    const post = new this.postModel({
      title: createPostDto.title,
      text: createPostDto.text,
      images: createPostDto.images || [],
      url: createPostDto.url,
    });
    return await post.save();
  }

  async getPosts(
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<Post>> {
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.postModel
        .find()
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.postModel.countDocuments().exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getPostById(id: string): Promise<Post | null> {
    return await this.postModel.findById(id).exec();
  }
}
