import 'express-serve-static-core';
import 'express-session';

declare module 'express-serve-static-core' {
  interface User {
    id: number;
    email: string;
    name: string;
    role: string;
  }

  interface ParamsDictionary {
    [key: string]: string;
  }

  interface Request {
    user?: User;
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  }
}

declare module 'express-session' {
  interface SessionData {
    passport: { user: number };
  }
}
