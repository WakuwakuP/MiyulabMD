export type User = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: number;
};

export type SessionUser = Pick<User, "id" | "email" | "displayName">;
