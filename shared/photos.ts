import {z} from 'zod';
export const PHOTO_EXTENSIONS=['.arw','.dng','.jpg','.jpeg','.png','.webp','.avif','.tif','.tiff'];
export const PHOTO_FILE_LIMIT=256*1024*1024;
export const photoEditsSchema=z.object({
  exposure:z.number().min(-3).max(3).default(0), contrast:z.number().min(-100).max(100).default(0),
  highlights:z.number().min(-100).max(100).default(0), shadows:z.number().min(-100).max(100).default(0),
  saturation:z.number().min(-100).max(100).default(0), temperature:z.number().min(-100).max(100).default(0),
  tint:z.number().min(-100).max(100).default(0),whiteBalance:z.enum(['camera','daylight']).default('camera'),
  denoise:z.boolean().default(false),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),
  flip:z.boolean().default(false),crop:z.object({x:z.number().min(0).max(.95),y:z.number().min(0).max(.95),width:z.number().min(.05).max(1),height:z.number().min(.05).max(1)}).strict().refine(c=>c.x+c.width<=1.000001&&c.y+c.height<=1.000001,'裁切范围超出图片').nullable().default(null)
}).strict();
export type PhotoEdits=z.infer<typeof photoEditsSchema>;
export const defaultPhotoEdits=()=>photoEditsSchema.parse({});
export type PhotoMetadata={make?:string;camera?:string;lens?:string;width:number;height:number;iso?:number;shutter?:number;aperture?:number;focalLength?:number;timestamp?:number;flip?:number;version?:string};
export type Photo={id:string;name:string;folder:string;format:string;raw:boolean;bytes:number;importedAt:number;metadata:PhotoMetadata;rating:number;flag:'none'|'pick'|'reject';tags:string[];edits:PhotoEdits;revision:number};
export type PhotoTask={id:string;kind:'import'|'export';status:'running'|'complete'|'partial'|'cancelled'|'failed';total:number;done:number;current:string;errors:string[];outputs:{photoId:string;name:string;bytes:number}[]};
export type PhotoLibraryState={photos:Photo[];task:PhotoTask|null;outputDirectory:string;rawAvailable:boolean};
export const photoExportSchema=z.object({ids:z.array(z.string().uuid()).min(1).max(500),format:z.enum(['jpeg','png','tiff','webp']),quality:z.number().int().min(1).max(100).default(92),longEdge:z.number().int().min(0).max(16000).default(0),tiff16:z.boolean().default(true)}).strict();
export type PhotoExport=z.infer<typeof photoExportSchema>;
