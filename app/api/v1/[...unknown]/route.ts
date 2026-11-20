// Unknown /api/v1 paths answer with the standard ApiError envelope (404 not_found).
import { errorResponse } from '@/server/http';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = (req: Request) => errorResponse(new AppError('not_found', `No route for ${req.method} ${new URL(req.url).pathname}`));

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
