export interface User {
  id: string;
  username: string;
  nombre: string;
  email: string | null;
  activo: boolean;
  ultimoLogin: string | null;
  createdAt: string;
  updatedAt: string;
}
