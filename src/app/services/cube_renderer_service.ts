import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

interface CameraParams {
  K: number[][];
}

interface Cube {
  bbox3D_cam: number[][];
  category_name: string;
}

@Injectable({
  providedIn: 'root'
})
export class CubeRendererService {
  constructor(private http: HttpClient) {}

  /**
   * Project 3D point to 2D using camera intrinsic matrix
   */
  private projectTo2D(point: number[], K: number[][]): [number, number] {
    // Convert point to homogeneous coordinates
    const x = point[0];
    const y = point[1];
    const z = point[2];

    // Project point using camera intrinsic matrix
    const u = (K[0][0] * x + K[0][2] * z) / z;
    const v = (K[1][1] * y + K[1][2] * z) / z;

    return [u, v];
  }

  drawCube(
    sceneDir: string, 
    cameraParams: any, 
    cubeList: any, 
    isGround = false
  ): Observable<HTMLCanvasElement> {
    const imageUrl = `${sceneDir}/input.png`;
    
    // Since both cameraParams and cubeList are provided as parameters,
    // we only need to load the image
    return new Observable<HTMLCanvasElement>((observer) => {
      // Load the image
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      
      img.onload = () => {
        // Create canvas and draw everything
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          observer.error('Could not get canvas context');
          return;
        }
        
        // Draw the original image
        ctx.drawImage(img, 0, 0);
        
        // Draw each cube using the provided camera intrinsic K
        const K = cameraParams;
        for (const cube of cubeList) {
          // Project 3D points to 2D
          const verts = cube.bbox3D_cam;
          const points2D = verts.map((point: any) => this.projectTo2D(point, K));
          
          // Find topmost point for text placement
          let minY = Infinity;
          let topmostPoint: [number, number] | null = null;
          
          for (const point of points2D) {
            if (point[1] < minY) {
              minY = point[1];
              topmostPoint = point;
            }
          }
          
          // Draw points
          for (const point of points2D) {
            ctx.beginPath();
            ctx.arc(point[0], point[1], 3, 0, 2 * Math.PI);
            ctx.fillStyle = 'green';
            ctx.fill();
          }
          
          // Define the edges of a cube
          const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
          ];
          
          // Draw edges
          ctx.strokeStyle = 'blue';
          ctx.lineWidth = 2;
          for (const [startIdx, endIdx] of edges) {
            const startPoint = points2D[startIdx];
            const endPoint = points2D[endIdx];
            
            ctx.beginPath();
            ctx.moveTo(startPoint[0], startPoint[1]);
            ctx.lineTo(endPoint[0], endPoint[1]);
            ctx.stroke();
          }
          
          // Draw category name
          if (topmostPoint) {
            ctx.fillStyle = 'red';
            ctx.font = '14px Arial';
            ctx.fillText(cube.category_name, topmostPoint[0], topmostPoint[1] - 10);
          }
        }
        
        observer.next(canvas);
        observer.complete();
      };
      
      img.onerror = (err) => {
        observer.error(`Error loading image: ${err}`);
      };
      
      img.src = imageUrl;
    });
  }

  /**
   * Save canvas as an image file
   * @param canvas Canvas to save
   * @param sceneDir Directory to save to
   * @param isGround Whether this is ground truth visualization
   */
  saveCanvasAsImage(canvas: HTMLCanvasElement, sceneDir: string, isGround = false): void {
    const outputFile = isGround ? 'vis_3Det_ground.png' : 'vis_3Det.png';
    
    // Convert canvas to data URL and trigger download
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = outputFile;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // In a real application, you might want to use HttpClient to upload this to the server
    // This example just downloads the file to the user's device
  }
}