import { Component, ElementRef, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { GLTFLoader, PLYLoader } from 'three/examples/jsm/Addons.js';
import { CommonModule } from '@angular/common';
import { TrackballControls } from 'three/examples/jsm/Addons.js';

interface BoundingBoxData {
  obj_id: string;
  category_name: string;
  center_cam: number[];
  R_cam: number[][];
  dimensions: number[];
  bbox3D_cam: number[][];
}

@Component({
  selector: 'app-ply-no-edit-viewer',
  imports: [CommonModule, FormsModule],
  standalone: true,
  template: `
    <div class="container">
      <div #rendererContainer class="scene-container"></div>
      <div class="controls">
        <div class="file-inputs">
          <input 
            type="file" 
            (change)="onPLYFileUpload($event)"
            accept=".ply"
            class="file-input"
            placeholder="Upload PLY File"
          />
          <input 
            type="file" 
            (change)="onGLBFileUpload($event)"
            accept=".glb,.gltf"
            class="file-input"
            placeholder="Upload GLB/GLTF File"
          />
          <input 
            type="file" 
            (change)="onJSONFileUpload($event)"
            accept=".json"
            class="file-input"
            placeholder="Upload JSON Bounding Box File"
          />
        </div>
        <div class="info-section">
          <div *ngIf="pointCloudStats" class="point-cloud-info">
            <p>Points: {{ pointCloudStats.points }}</p>
            <p>Bounds: 
              X: [{{ pointCloudStats.boundingBox.min.x.toFixed(2) }}, 
                  {{ pointCloudStats.boundingBox.max.x.toFixed(2) }}]
              Y: [{{ pointCloudStats.boundingBox.min.y.toFixed(2) }}, 
                  {{ pointCloudStats.boundingBox.max.y.toFixed(2) }}]
              Z: [{{ pointCloudStats.boundingBox.min.z.toFixed(2) }}, 
                  {{ pointCloudStats.boundingBox.max.z.toFixed(2) }}]
            </p>
          </div>
          <div class="point-size-control">
            <label>Point Size: 
              <input 
                type="range" 
                [value]="pointSize"
                (input)="updatePointSize($event)"
                min="0.01" 
                max="0.5" 
                step="0.01"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
    }
    .scene-container {
      flex-grow: 1;
      width: 100%;
      height: 100%;
    }
    .controls {
      padding: 10px;
      background-color: #f0f0f0;
      display: flex;
      flex-direction: column;
    }
    .file-inputs {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }
    .info-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .point-cloud-info {
      font-size: 0.8rem;
      color: #333;
    }
    .file-input {
      max-width: 300px;
    }
  `]
})
export class WithoutEditPlyViewerComponent implements OnInit, OnDestroy {
  @ViewChild('rendererContainer', { static: true }) 
  rendererContainer!: ElementRef;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private trackballControls!: TrackballControls;
  
  private pointCloud: THREE.Points | null = null;
  private glbModel: THREE.Group | null = null;
  private boundingBoxMesh: THREE.LineSegments | null = null;
  private axesHelper!: THREE.AxesHelper;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  pointCloudStats: {
    points: number;
    boundingBox: {
      min: THREE.Vector3;
      max: THREE.Vector3;
    }
  } | null = null;

  pointSize: number = 0.05;

  ngOnInit() {
    this.initScene();
    this.setupEventListeners();
    this.animate();
  }

  ngOnDestroy() {
    // Cleanup
    this.trackballControls.dispose();
    this.renderer.dispose();
    
    // Remove existing objects
    this.clearScene();

    // Remove event listeners
    window.removeEventListener('resize', this.onWindowResize);
    this.rendererContainer.nativeElement.removeEventListener('dblclick', this.onDoubleClick);
  }

  private clearScene() {
    // Remove point cloud
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud);
      this.pointCloud = null;
    }

    // Remove GLB model
    if (this.glbModel) {
      this.scene.remove(this.glbModel);
      this.glbModel = null;
    }

    // Remove bounding box
    if (this.boundingBoxMesh) {
      this.scene.remove(this.boundingBoxMesh);
      this.boundingBoxMesh = null;
    }

    // Remove axes helper
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
    }
  }

  private initScene() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    // Container
    const container = this.rendererContainer.nativeElement;

    // Renderer with full container size and high pixel ratio
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Camera with full view
    this.camera = new THREE.PerspectiveCamera(
      45, 
      container.clientWidth / container.clientHeight, 
      0.1, 
      1000
    );

    // TrackballControls for full rotation
    this.trackballControls = new TrackballControls(this.camera, this.renderer.domElement);
    
    // Configure TrackballControls
    this.trackballControls.rotateSpeed = 1.0;
    this.trackballControls.zoomSpeed = 1.2;
    this.trackballControls.panSpeed = 0.8;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight1.position.set(1, 1, 1);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-1, -1, -1);
    this.scene.add(directionalLight2);

    // Axes Helper
    this.axesHelper = new THREE.AxesHelper(10);
    this.scene.add(this.axesHelper);

    // Initial camera position
    this.camera.position.z = 5;

    // Ensure initial resize
    this.onWindowResize();
  }

  private setupEventListeners() {
    window.addEventListener('resize', this.onWindowResize);
    this.rendererContainer.nativeElement.addEventListener('dblclick', this.onDoubleClick);
  }

  private onWindowResize = () => {
    const container = this.rendererContainer.nativeElement;
    
    // Update camera aspect ratio
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();

    // Update renderer size
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  private onDoubleClick = (event: MouseEvent) => {
    // Calculate mouse position in normalized device coordinates
    const container = this.rendererContainer.nativeElement;
    this.mouse.x = (event.clientX / container.clientWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / container.clientHeight) * 2 + 1;

    // Set up the raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for intersections with the point cloud or GLB model
    const intersectObjects: THREE.Object3D[] = [];
    if (this.pointCloud) intersectObjects.push(this.pointCloud);
    if (this.glbModel) intersectObjects.push(this.glbModel);

    const intersects = this.raycaster.intersectObjects(intersectObjects);

    if (intersects.length > 0) {
      // Get the first intersected point
      const intersectionPoint = intersects[0].point;

      // Adjust camera to focus on this point
      this.focusOnPoint(intersectionPoint);
    }
  }

  private focusOnPoint(point: THREE.Vector3) {
    // Smoothly move the camera target to the selected point
    this.trackballControls.target.copy(point);
    
    // Adjust camera distance
    const distanceToPoint = this.camera.position.distanceTo(point);
    const newCameraPosition = point.clone().sub(
      this.camera.position.clone()
        .sub(point)
        .normalize()
        .multiplyScalar(distanceToPoint)
    );

    // Animate camera movement
    this.animateCameraToPosition(newCameraPosition, point);
  }

  private animateCameraToPosition(newPosition: THREE.Vector3, target: THREE.Vector3) {
    const duration = 500; // Animation duration in milliseconds
    const startPosition = this.camera.position.clone();
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Interpolate camera position
      this.camera.position.lerpVectors(startPosition, newPosition, progress);
      
      // Update trackball controls target
      this.trackballControls.target.copy(target);
      this.trackballControls.update();

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    
    // Update controls
    this.trackballControls.update();
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
  }

  onPLYFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      this.loadPLYFile(arrayBuffer);
    };

    reader.readAsArrayBuffer(file);
  }

  onGLBFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      this.loadGLBFile(arrayBuffer);
    };

    reader.readAsArrayBuffer(file);
  }

  private loadPLYFile(arrayBuffer: ArrayBuffer) {
    // Remove existing point cloud
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud);
    }
  
    // Create PLY loader
    const loader = new PLYLoader();
    const geometry = loader.parse(arrayBuffer);
  
    // Coordinate transformation matrix
    const transformMatrix = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    );
  
    // Apply coordinate transformation to geometry
    const positions = geometry.getAttribute('position');
    const transformedPositions = new Float32Array(positions.count * 3);
  
    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      );
  
      // Transform the vertex
      vertex.applyMatrix4(transformMatrix);
  
      transformedPositions[i * 3] = vertex.x;
      transformedPositions[i * 3 + 1] = vertex.y;
      transformedPositions[i * 3 + 2] = vertex.z;
    }
  
    // Replace original positions with transformed positions
    geometry.setAttribute('position', new THREE.BufferAttribute(transformedPositions, 3));
  
    // Prepare color material
    let material: THREE.PointsMaterial;
    
    // Check if geometry has color attribute
    if (geometry.hasAttribute('color')) {
      // Use vertex colors if available
      material = new THREE.PointsMaterial({ 
        size: this.pointSize,
        vertexColors: true
      });
    } else {
      // Fallback to default green color
      material = new THREE.PointsMaterial({ 
        color: 0x00ff00,
        size: this.pointSize
      });
    }
  
    // Create point cloud without centering
    this.pointCloud = new THREE.Points(geometry, material);
  
    // Update point cloud stats
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    if (boundingBox) {
      this.pointCloudStats = {
        points: geometry.attributes['position'].count,
        boundingBox: {
          min: boundingBox.min,
          max: boundingBox.max
        }
      };
    }
  
    // Add to scene at original position
    this.scene.add(this.pointCloud);
  
    // Adjust camera to view the entire point cloud
    this.fitCameraToObject(this.pointCloud);
  }
  
  private loadGLBFile(arrayBuffer: ArrayBuffer) {
    // Remove existing GLB model
    if (this.glbModel) {
      this.scene.remove(this.glbModel);
    }
  
    // Create GLTF loader
    const loader = new GLTFLoader();
  
    // Parse the ArrayBuffer
    loader.parse(arrayBuffer, '', (gltf) => {
      // Store the model without any positioning modifications
      this.glbModel = gltf.scene;
  
      // Traverse meshes to preserve original materials
      this.glbModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Handle potential array of materials or single material
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          
          child.material = materials.map(material => {
            // Check if it's a standard material that supports color and other properties
            if (material instanceof THREE.MeshStandardMaterial) {
              const stdMaterial = material as THREE.MeshStandardMaterial;
              return stdMaterial.clone();
            }
            return material;
          });
  
          // If it was a single material, unwrap from array
          if (materials.length === 1) {
            child.material = child.material[0];
          }
        }
      });
  
      // Add to scene without any positioning modifications
      this.scene.add(this.glbModel);
  
      // Adjust camera to view the entire model
      this.fitCameraToObject(this.glbModel);
    }, 
    // Error handling
    (error) => {
      console.error('Error loading GLB file:', error);
    });
  }

  private fitCameraToObject(object: THREE.Points | THREE.Group) {
    const boundingBox = new THREE.Box3().setFromObject(object);
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // Compute the distance to fit the object
    const fitHeightDistance = maxDim / (2 * Math.atan(Math.PI / 4));
    const fitWidthDistance = fitHeightDistance / this.camera.aspect;
    const distance = 1.5 * Math.max(fitHeightDistance, fitWidthDistance);

    const center = boundingBox.getCenter(new THREE.Vector3());
    
    // Position camera
    this.camera.position.copy(center);
    this.camera.position.z += distance;
    this.camera.lookAt(center);

    // Update trackball controls
    this.trackballControls.target.copy(center);
    this.trackballControls.update();

    // Reposition axes helper to object center
    this.axesHelper.position.copy(center);
  }

  onJSONFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const jsonContent = e.target?.result as string;
      this.loadBoundingBoxFromJSON(jsonContent);
    };

    reader.readAsText(file);
  }

  private loadBoundingBoxFromJSON(jsonContent: string) {
    // Remove existing bounding box
    if (this.boundingBoxMesh) {
      this.scene.remove(this.boundingBoxMesh);
    }
  
    try {
      const data: BoundingBoxData[] = JSON.parse(jsonContent);
      
      if (data.length === 0) {
        console.warn('No bounding box data found in JSON');
        return;
      }
  
      // Use the first bounding box in the file
      const bboxData = data[0];
      
      // Create bounding box geometry
      const bbox3D = bboxData.bbox3D_cam;
      const geometry = new THREE.BufferGeometry();
  
      // Flatten vertices manually with explicit type handling
      const flatVertices: number[] = [];
      bbox3D.forEach(vertex => {
        flatVertices.push(vertex[0], vertex[1], vertex[2]);
      });
  
      // Define edges of the bounding box using the flattened vertices
      const edgeIndices = [
        0, 1, 1, 2, 2, 3, 3, 0,  // First face
        4, 5, 5, 6, 6, 7, 7, 4,  // Second face
        0, 4,  // Connecting lines between faces
        1, 5, 
        2, 6, 
        3, 7
      ];
  
      const edgeVertices = edgeIndices.map(index => flatVertices.slice(index * 3, index * 3 + 3)).flat();
  
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3));
  
      // Create bounding box mesh with edges
      const material = new THREE.LineBasicMaterial({ 
        color: 0xff0000,  // Red color for bounding box
        linewidth: 2
      });
  
      this.boundingBoxMesh = new THREE.LineSegments(geometry, material);
  
      // Add to scene WITHOUT centering
      this.scene.add(this.boundingBoxMesh);
  
      // Optional: Log bounding box details for debugging
    } catch (error) {
      console.error('Error parsing JSON:', error);
    }
  }

  updatePointSize(event: Event) {
    this.pointSize = parseFloat((event.target as HTMLInputElement).value);
    
    if (this.pointCloud) {
      const pointMaterial = this.pointCloud.material as THREE.PointsMaterial;
      pointMaterial.size = this.pointSize;
      
      // Force material update
      pointMaterial.needsUpdate = true;
    }
  }
}