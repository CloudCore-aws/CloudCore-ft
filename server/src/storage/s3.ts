import { PassThrough, type Readable } from 'node:stream';
import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from './types.js';

let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: process.env.AWS_REGION }));
const Bucket = () => process.env.S3_BUCKET!;

export class S3Storage implements StorageDriver {
  async put(key: string, stream: NodeJS.ReadableStream | Readable) {
    await new Upload({ client: s3(), params: { Bucket: Bucket(), Key: key, Body: stream as Readable } }).done();
  }

  get(key: string): Readable {
    // Interface is synchronous, so hand back a stream and fill it when S3 answers
    const out = new PassThrough();
    s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }))
      .then((r) => (r.Body as Readable).pipe(out))
      .catch((err) => out.destroy(err));
    return out;
  }

  async delete(key: string) {
    await s3().send(new DeleteObjectCommand({ Bucket: Bucket(), Key: key })); // no error if already gone
  }
}

// Browser uploads straight to S3 with this URL (valid 5 minutes)
export const presignPut = (key: string, contentType: string) =>
  getSignedUrl(s3(), new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType }), { expiresIn: 300 });

// Receiver downloads straight from S3 with this URL (valid 60 seconds)
export const presignGet = (key: string, fileName: string) =>
  getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: Bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    { expiresIn: 60 }
  );

// Real size of what was uploaded (or null if nothing arrived)
export const objectSize = async (key: string) => {
  try {
    return (await s3().send(new HeadObjectCommand({ Bucket: Bucket(), Key: key }))).ContentLength ?? 0;
  } catch {
    return null;
  }
};