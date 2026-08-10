export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export function buildResponse<T>(data: T, message = 'OK') {
  return { success: true, message, data };
}

export function buildError(message: string, errors?: string[]) {
  return { success: false, message, errors };
}
