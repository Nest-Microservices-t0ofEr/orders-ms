import { Catch, ArgumentsHost, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

@Catch(RpcException)
export class RpcCustomExceptionFilter implements ExceptionFilter {
    catch(exception: RpcException, host: ArgumentsHost) {
        const ctx = host.switchToRpc();
        const rpcError = exception.getError();

        if (!rpcError) {
            return {
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                message: exception,
            };
        }

        if (typeof rpcError === 'string' && rpcError.includes('Empty response')) {
            return {
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                message: rpcError.substring(0, rpcError.indexOf('(') - 1),
            };
        }

        if (typeof rpcError === 'object' && 'status' in rpcError && 'message' in rpcError) {
            return {
                status: typeof rpcError.status !== 'number' ? HttpStatus.BAD_REQUEST : rpcError.status,
                message: rpcError.message,
            };
        }

        return {
            status: HttpStatus.BAD_REQUEST,
            message: typeof rpcError === 'string' ? rpcError : exception,
        };
    }
}