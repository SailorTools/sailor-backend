export function getCookie(req: any, name: string) {
    const cookie = req.headers.cookie ?? "";
    const match = cookie.match(new RegExp(`${name}=([^;]+)`));
    return match?.[1];
  }