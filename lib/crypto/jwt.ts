import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export async function signJwt(payload: JWTPayload, hmacKey: CryptoKey, kid?: string): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader(kid ? { alg: "HS256", kid } : { alg: "HS256" })
    .setIssuedAt()
    .sign(hmacKey);
}

export async function verifyJwt<T extends object = JWTPayload>(token: string, hmacKey: CryptoKey): Promise<T & JWTPayload> {
  const { payload } = await jwtVerify<T>(token, hmacKey, { algorithms: ["HS256"] });
  return payload;
}
