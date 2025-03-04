import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from 'src/prisma.service';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { firstValueFrom } from 'rxjs';
import { NATS_SERVICE } from 'src/config/services';
import { OrderWithProducts } from './interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto/paid-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    @Inject(NATS_SERVICE)private readonly client: ClientProxy,
  ){}
  async create(createOrderDto: CreateOrderDto) {
    try {
      const productsIds = createOrderDto.items.map((item) => item.productId);
      const uniqueProductsIds = Array.from(new Set(productsIds));
      const products = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, uniqueProductsIds)
      );
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId)
          .price;
        return acc + (price * orderItem.quantity);
      }, 0);
      
      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);
      
      const order = await this.prisma.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          orderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                price: products.find( 
                  product => product.id === orderItem.productId
                  ).price, 
                productId: orderItem.productId,
                quantity: orderItem.quantity,
              }))
            }
          }
        },
        include: {
          orderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      })
      return { 
        ...order,
        orderItem: order.orderItem.map(
          (orderItem) => ({
            ...orderItem,
            name: products.find(product => product.id === orderItem.productId).name
          })
        )
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
        error: error,
      })
    }
    
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page = 1, limit = 10 } = orderPaginationDto;
    const totalPages = await this.prisma.order.count({
      where: {
        status: orderPaginationDto.status,
      }
    });
    const lastPage = Math.ceil( totalPages / limit );
    return { 
      data: await this.prisma.order.findMany({
        skip: ( page - 1 ) * limit,
        take: limit,
        where: {status: orderPaginationDto.status},
      }),
      meta: {
        total: totalPages,
        page: page,
        lastpage: lastPage,
      }
    };
  }

  async findOne(id: string){
    const order = await this.prisma.order.findFirst({
      where: {id}
    });
    if(!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id #${id}, not found`
      });
    }
    return order;
  }

  async changeStatus(changeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;
    const order = await this.findOne(id);
    if(order.status === status) {
      return order;
    }
    return this.prisma.order.update({
      where: { id },
      data: { status: status }
    })
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.orderItem.map((orderItem) => ({
          name: orderItem.name,
          price: orderItem.price,
          quantity: orderItem.quantity,
        }))
      })
    );
    return paymentSession;
  }

  async paidOrder(paidOrderDto: PaidOrderDto) {
    const order = await this.findOne(paidOrderDto.orderId);
    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,
        orderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl,
          }
        }
      }
    });
  }
}
