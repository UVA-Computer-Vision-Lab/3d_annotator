import { Component, ElementRef, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/Addons.js';
import { CommonModule } from '@angular/common';
import { TrackballControls } from 'three/examples/jsm/Addons.js';
import { ImageViewerComponent } from "../imge_viewer/image_viewer.component";
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

interface BoundingBoxData {
  obj_id: string;
  category_name: string;
  center_cam: number[];
  R_cam: number[][];
  dimensions: number[];
  bbox3D_cam: number[][];
  euler_angles_xyz: number[]
}

interface BoundingBoxEditData {
  obj_id: string;
  category_name: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  // Dimensions in local coordinate system
  localSizeX: number;  // Size along local X axis
  localSizeY: number;  // Size along local Y axis
  localSizeZ: number;  // Size along local Z axis
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  // Precise rotation matrix (primary rotation representation)
  rotationMatrix: THREE.Matrix4;
}

@Component({
  selector: 'app-ply-two-viewer',
  imports: [CommonModule, FormsModule, ImageViewerComponent],
  standalone: true,
  templateUrl: './UploadPly_2.component.html',
  styleUrl: './UploadPly_2.component.css'
})
export class PlyViewer2Component implements OnInit, OnDestroy {
  @ViewChild('rendererContainer', { static: true })
  rendererContainer!: ElementRef;

  // 2D View canvas references
  @ViewChild('topCanvas', { static: false })
  topCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('frontCanvas', { static: false })
  frontCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sideCanvas', { static: false })
  sideCanvas!: ElementRef<HTMLCanvasElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private trackballControls!: TrackballControls;

  // 2D View properties
  private topViewCtx: CanvasRenderingContext2D | null = null;
  private frontViewCtx: CanvasRenderingContext2D | null = null;
  private sideViewCtx: CanvasRenderingContext2D | null = null;

  // 2D View camera parameters (zoom and pan)
  private topViewZoom: number = 50; // pixels per meter
  private frontViewZoom: number = 50;
  private sideViewZoom: number = 50;

  private topViewPan: { x: number, y: number } = { x: 0, y: 0 };
  private frontViewPan: { x: number, y: number } = { x: 0, y: 0 };
  private sideViewPan: { x: number, y: number } = { x: 0, y: 0 };

  // Point cloud data for 2D projection
  private pointCloudPositions: Float32Array | null = null;
  private pointCloudColors: Float32Array | null = null;

  // Initial box state for reference coordinate system - per view
  // When dragging in a view, that view's point cloud stays fixed using its initial state
  // Other views update to use current box state
  private topViewInitialRotation: { x: number, y: number, z: number } | null = null;
  private topViewInitialCenter: { x: number, y: number, z: number } | null = null;
  private topViewInitialDimensions: { x: number, y: number, z: number } | null = null;
  private frontViewInitialRotation: { x: number, y: number, z: number } | null = null;
  private frontViewInitialCenter: { x: number, y: number, z: number } | null = null;
  private frontViewInitialDimensions: { x: number, y: number, z: number } | null = null;
  private sideViewInitialRotation: { x: number, y: number, z: number } | null = null;
  private sideViewInitialCenter: { x: number, y: number, z: number } | null = null;
  private sideViewInitialDimensions: { x: number, y: number, z: number } | null = null;

  // Track which view is currently being dragged
  private currentDraggingView: 'top' | 'front' | 'side' | null = null;
  // Track what is being dragged (corner index: -1=center, 0-7=corners, 100-103=edges)
  private currentDraggingCornerIndex: number | null = null;
  // Track the actual mouse drag angle (for 2D display to match mouse exactly)
  private currentDraggingAngleDelta: number = 0;
  // Throttle 2D rendering during drag for performance
  private render2DThrottleTimer: any = null;

  private pointCloud: THREE.Points | null = null;
  private boundingBoxMesh: THREE.Group | THREE.LineSegments | null = null;

  private axesHelper!: THREE.AxesHelper;
  isEditMode = false;
  selectedBoundingBoxIndex: number = 0;

  boundingJsonBoxData: BoundingBoxData[] = [];

  private keydownListener: ((event: KeyboardEvent) => void) | null = null;
  private keyupListener: ((event: KeyboardEvent) => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private animationFrameId: number | null = null;
  private routeSubscription: Subscription | null = null;

  // 2D Canvas event listeners for cleanup
  private topCanvasListeners: Map<string, EventListener> = new Map();
  private frontCanvasListeners: Map<string, EventListener> = new Map();
  private sideCanvasListeners: Map<string, EventListener> = new Map();

  // Current page for navigation
  private currentPage: number = 1;

  keyState: any;

  optOutChecked: boolean = false;
  optOutStatus: boolean = false;
  optOutMessage: string = '';
  optOutSuccess: boolean = false;
  
  // Add annotation status properties
  isAnnotated: boolean = false;
  annotationCheckComplete: boolean = false;
  
  // Add annotator properties
  annotatorName: string = '';
  currentAnnotator: string | null = null;
  showAnnotatorInput: boolean = false;

  // Add timing properties
  annotationStartTime: number = 0;
  annotationEndTime: number = 0;
  annotationDuration: number = 0;

  // Toast notification properties
  toastVisible: boolean = false;
  toastMessage: string = '';
  private toastTimeout: any = null;

  // Sorting preference from route
  private sortBy: string = 'name';

  private apiBaseUrl = environment.apiBaseUrl;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) { }

  pointCloudStats: {
    points: number;
    boundingBox: {
      min: THREE.Vector3;
      max: THREE.Vector3;
    }
  } | null = null;

  pointSize: number = 0.05;
  maxDepth: number = 20; // Default maximum depth in meters

  initialRotation: any;
  rotationCenter: THREE.Vector3 = new THREE.Vector3();
  lastDragPosition: any;
  startDragAngle: any;
  // New property for bounding box editing
  boundingBoxEditData: BoundingBoxEditData[] = [];
  basePath: any;
  decoded_path: any;
  private isDepthFileLoaded: boolean = false;
  private isBoundingBoxLoaded: boolean = false;
  private type: string = 'default';

  // Modified ngOnInit to store the subscription
  ngOnInit() {
    // Read sortBy from query params
    this.route.queryParams.subscribe(queryParams => {
      this.sortBy = queryParams['sortBy'] || 'name';
    });

    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const encodedPath = params.get('path');
      const bbox_type = params.get('type');
      this.type = bbox_type ? decodeURIComponent(bbox_type) : 'deafult';
      this.basePath = encodedPath ? decodeURIComponent(encodedPath) : '';
      this.loadDataFromPath(this.basePath);
      this.checkOptOutStatus();
      this.checkAnnotationStatus();
    });

    this.initScene();
    this.animate();
    this.setupEventListeners();
    this.loadAnnotatorFromCache();
    // this.loadFolderList();
  }

  private checkOptOutStatus() {
    if (!this.decoded_path) return;

    const id = this.getDirectoryIdFromPath();
    if (!id) return;

    // Reset state first
    this.optOutChecked = false;
    this.optOutStatus = false;
    this.optOutSuccess = false;
    this.optOutMessage = '';

    fetch(`${this.apiBaseUrl}/assets/val/${id}/deleted.json`)
      .then((response: any) => {
        if (response.ok) {
          return response.json().then(() => {
            this.optOutChecked = true;
            this.optOutStatus = true;
            this.optOutSuccess = true;
            this.optOutMessage = 'This image is marked for deletion';
          });
        } else {
          // If response is not ok (404 or other error), reset state
          this.optOutChecked = false;
          this.optOutStatus = false;
          this.optOutSuccess = false;
          this.optOutMessage = '';
        }
      })
      .catch(() => {
        // File doesn't exist, which is fine
        this.optOutChecked = false;
        this.optOutStatus = false;
        this.optOutSuccess = false;
        this.optOutMessage = '';
      });
  }

  private checkAnnotationStatus() {
    if (!this.decoded_path) return;

    const id = this.getDirectoryIdFromPath();
    if (!id) return;

    // Reset annotation state
    this.isAnnotated = false;
    this.annotationCheckComplete = false;
    this.currentAnnotator = null;

    // Check if 3dbox_refined.json exists (indicates the image has been annotated)
    fetch(`${this.apiBaseUrl}/assets/val/${id}/3dbox_refined.json`)
      .then((response: any) => {
        this.annotationCheckComplete = true;
        if (response.ok) {
          this.isAnnotated = true;
          // Also check for annotator info
          this.loadAnnotatorInfo();
        } else {
          this.isAnnotated = false;
        }
      })
      .catch(() => {
        // File doesn't exist, image hasn't been annotated
        this.annotationCheckComplete = true;
        this.isAnnotated = false;
      });
  }
  
  private loadAnnotatorInfo() {
    const id = this.getDirectoryIdFromPath();
    if (!id) return;
    
    fetch(`${this.apiBaseUrl}/assets/val/${id}/annotator_info.json`)
      .then(response => response.json())
      .then(data => {
        if (data && data.annotator) {
          this.currentAnnotator = data.annotator;
        }
      })
      .catch(() => {
        // File doesn't exist or error loading, that's okay
        this.currentAnnotator = null;
      });
  }
  
  private loadAnnotatorFromCache() {
    const cached = localStorage.getItem('annotatorName');
    if (cached) {
      this.annotatorName = cached;
    }
  }
  
  saveAnnotatorName() {
    const trimmedName = this.annotatorName.trim();
    if (trimmedName) {
      localStorage.setItem('annotatorName', trimmedName);
      this.showAnnotatorInput = false;
    } else {
      alert('Please enter a valid annotator name');
    }
  }
  
  toggleAnnotatorInput() {
    this.showAnnotatorInput = !this.showAnnotatorInput;
    // If canceling edit, restore the original name from localStorage
    if (!this.showAnnotatorInput) {
      const savedName = localStorage.getItem('annotatorName');
      if (savedName) {
        this.annotatorName = savedName;
      }
    }
  }
  handleSelectKeyDown(event: KeyboardEvent) {
    if (['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      // Handle the arrow key press as needed
    }
  }

  handleOptOut() {
    const id = this.getDirectoryIdFromPath();
    if (!id) {
      this.showOptOutMessage(false, 'Invalid directory path');
      return;
    }

    // Check if annotator name is set
    if (this.optOutChecked && !this.annotatorName.trim()) {
      alert('Please enter your name as the annotator before marking for deletion.');
      this.showAnnotatorInput = true;
      this.optOutChecked = false; // Uncheck the checkbox
      return;
    }

    if (this.optOutChecked) {
      // Create deleted.json file with annotator info
      const deleteData = {
        deleted: true,
        timestamp: new Date().toISOString(),
        annotator: this.annotatorName.trim(),
        reason: 'opt_out'
      };

      fetch(`${this.apiBaseUrl}/api/save/${id}/deleted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(deleteData)
      })
        .then(response => response.json())
        .then(result => {
          if (result.success) {
            this.showOptOutMessage(true, 'Successfully marked for deletion');
          } else {
            this.showOptOutMessage(false, 'Failed to mark for deletion: ' + result.error);
          }
        })
        .catch(error => {
          this.showOptOutMessage(false, 'Network error: ' + error.message);
        });
    } else {
      // Remove the deleted.json file by calling the DELETE endpoint
      fetch(`${this.apiBaseUrl}/api/save/${id}/deleted`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(response => {
          if (!response.ok) {
            // If response is not ok, try to parse error message
            return response.json().then(errData => {
              throw new Error(errData.error || `HTTP error ${response.status}`);
            }).catch(() => {
              throw new Error(`HTTP error ${response.status}`);
            });
          }
          return response.json();
        })
        .then(result => {
          if (result.success) {
            this.showOptOutMessage(true, 'Deletion marker removed successfully');
          } else {
            this.showOptOutMessage(false, 'Failed to remove deletion marker: ' + result.error);
          }
        })
        .catch(error => {
          console.error('Error removing deletion marker:', error);
          // If file doesn't exist, still consider it a success locally
          if (error.message.includes('not found') || error.message.includes('404')) {
            this.optOutStatus = false;
            this.optOutMessage = '';
          } else {
            this.showOptOutMessage(false, 'Error removing deletion marker: ' + error.message);
          }
        });
    }
  }

  // Helper method to show opt-out status messages
  private showOptOutMessage(success: boolean, message: string) {
    this.optOutStatus = true;
    this.optOutSuccess = success;
    this.optOutMessage = message;

    // Hide message after 5 seconds
    setTimeout(() => {
      this.optOutStatus = false;
    }, 5000);
  }

  // Helper method to extract directory ID from path
  private getDirectoryIdFromPath(): string | null {
    if (!this.decoded_path) return null;
    const pathParts = this.decoded_path.split('/');
    return pathParts.length > 0 ? pathParts[pathParts.length - 1] : null;
  }


  deleteSelectedBoundingBox() {
    if (this.selectedBoundingBoxIndex === null || this.boundingBoxEditData.length === 0) {
      return;
    }

    // Remove from editing data array
    this.boundingBoxEditData.splice(this.selectedBoundingBoxIndex, 1);

    // Remove from JSON data array for export
    this.boundingJsonBoxData.splice(this.selectedBoundingBoxIndex, 1);
    // Trigger change detection by creating new array reference
    this.boundingJsonBoxData = [...this.boundingJsonBoxData];

    // Remove from scene and dispose resources
    if (this.boundingBoxMesh instanceof THREE.Group) {
      const childToRemove = this.boundingBoxMesh.children[this.selectedBoundingBoxIndex];

      // Dispose geometry and material before removing
      if (childToRemove instanceof THREE.LineSegments || childToRemove instanceof THREE.Mesh) {
        if (childToRemove.geometry) {
          childToRemove.geometry.dispose();
        }
        if (childToRemove.material) {
          if (Array.isArray(childToRemove.material)) {
            childToRemove.material.forEach(mat => mat.dispose());
          } else {
            childToRemove.material.dispose();
          }
        }
      }

      this.boundingBoxMesh.remove(childToRemove);
    }

    // If there are no more bounding boxes, handle empty state
    if (this.boundingBoxEditData.length === 0) {
      this.selectedBoundingBoxIndex = -1;
      // Optionally trigger opt-out if no boxes remain
      if (!this.optOutChecked) {
        this.optOutChecked = true;
        this.handleOptOut();
      }
    } else {
      // Select next available box or the last one
      this.selectedBoundingBoxIndex = Math.min(
        this.selectedBoundingBoxIndex,
        this.boundingBoxEditData.length - 1
      );
      this.onBoundingBoxSelect();
    }

    // Update the scene
    this.renderer.render(this.scene, this.camera);
  }

  loadDataFromPath(path: string) {
    try {
      // Clean up previous scene resources before loading new data
      this.cleanupSceneResources();

      // Reset loading flags
      this.isDepthFileLoaded = false;
      this.isBoundingBoxLoaded = false;

      // Start timing for this annotation
      this.annotationStartTime = Date.now();
      this.annotationDuration = 0;

      // Decode the path if it was URL-encoded
      const decodedPath = decodeURIComponent(path);
      this.decoded_path = decodedPath;

      // Extract the folder ID from the path
      const folderId = this.getDirectoryIdFromPath();
      if (!folderId) {
        return;
      }

      // Load PLY file
      fetch(`${this.apiBaseUrl}/assets/val/${folderId}/depth_scene.ply`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load PLY file: ${response.status} ${response.statusText}`);
          }
          return response.arrayBuffer();
        })
        .then(arrayBuffer => {
          this.loadPLYFile(arrayBuffer);
          this.isDepthFileLoaded = true;
          this.checkInitializeScene();
        })
        .catch(error => {
          console.error('Error loading PLY file:', error);
        });

      // Load bounding box file
      const file = this.type === 'default' ? '3dbbox_ground_no_icp' : '3dbox_refined';
      fetch(`${this.apiBaseUrl}/assets/val/${folderId}/${file}.json`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load bounding box file: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then(jsonData => {
          this.loadBoundingBoxFromJSON(JSON.stringify(jsonData));
          this.isBoundingBoxLoaded = true;
          this.checkInitializeScene();
        })
        .catch(error => {
          console.error('Error loading bounding box file:', error);
        });

    } catch (error) {
      console.error('Error accessing file:', error);
    }
  }

  // New method to check if both files are loaded and initialize the scene
  private checkInitializeScene() {
    if (this.isDepthFileLoaded && this.isBoundingBoxLoaded) {
      // Re-center camera on the selected box (to ensure it's not overridden by fitCameraToObject)
      if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData.length > 0) {
        this.onBoundingBoxSelect();
      }

      // Start animation loop only when both files are loaded
      // IMPORTANT: Cancel previous animation frame to prevent multiple loops
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.animate();
    }
  }
  ngAfterViewInit() {
    // Ensure the container is ready
    setTimeout(() => {
      // Update renderer size based on actual container dimensions
      const container = this.rendererContainer.nativeElement;
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width > 0 && height > 0) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }

      this.renderer.render(this.scene, this.camera);
      this.init2DViews();
    }, 100);
  }
  private initScene() {
    // Scene setup (similar to previous implementation)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    const container = this.rendererContainer.nativeElement;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    const gl = this.renderer.getContext();
    gl.lineWidth(20); // This won't always work, but worth trying
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || 500
    );

    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || 500),
      0.1,
      1000
    );

    this.trackballControls = new TrackballControls(this.camera, this.renderer.domElement);

    this.trackballControls.rotateSpeed = 1.0;
    this.trackballControls.zoomSpeed = 1.2;
    this.trackballControls.panSpeed = 0.8;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight1.position.set(1, 1, 1);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-1, -1, -1);
    this.scene.add(directionalLight2);

    // this.axesHelper = new THREE.AxesHelper(10);
    // this.scene.add(this.axesHelper);

    this.camera.position.z = 5;
  }

  // Modified animate method to store the animation frame ID
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Update trackball controls when not in edit mode
    if (!this.isEditMode) {
      this.trackballControls.update();
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }

  // Modified setupEventListeners method to store references to listeners
  private setupEventListeners() {
    // Store key states
    this.keyState = {
      KeyR: false,
      KeyC: false,
      KeyD: false,
      KeyX: false,
      KeyY: false,
      KeyZ: false,
      ArrowRight: false,
      ArrowLeft: false
    };

    type ModeName = 'R' | 'C' | 'D';
    type AxisName = 'X' | 'Y' | 'Z';
    type DirectionName = 'Right' | 'Left';

    // Define actions based on key combinations with proper typing
    const keyActions: Record<ModeName, Record<AxisName, Record<DirectionName, (idx: number) => void>>> = {
      // Rotations (R + axis + direction)
      R: {
        X: {
          Right: (idx) => { this.applyLocalRotation(idx, 'X', 0.01); },
          Left: (idx) => { this.applyLocalRotation(idx, 'X', -0.01); }
        },
        Y: {
          Right: (idx) => { this.applyLocalRotation(idx, 'Y', 0.01); },
          Left: (idx) => { this.applyLocalRotation(idx, 'Y', -0.01); }
        },
        Z: {
          Right: (idx) => { this.applyLocalRotation(idx, 'Z', 0.01); },
          Left: (idx) => { this.applyLocalRotation(idx, 'Z', -0.01); }
        }
      },
      // Positions/Centers (C + axis + direction)
      C: {
        X: {
          Right: (idx) => { this.applyLocalTranslation(idx, 'X', 0.01); },
          Left: (idx) => { this.applyLocalTranslation(idx, 'X', -0.01); }
        },
        Y: {
          Right: (idx) => { this.applyLocalTranslation(idx, 'Y', 0.01); },
          Left: (idx) => { this.applyLocalTranslation(idx, 'Y', -0.01); }
        },
        Z: {
          Right: (idx) => { this.applyLocalTranslation(idx, 'Z', 0.01); },
          Left: (idx) => { this.applyLocalTranslation(idx, 'Z', -0.01); }
        }
      },
      // Dimensions (D + axis + direction)
      D: {
        X: {
          // D.X adjusts size along local X axis
          Right: (idx) => { this.boundingBoxEditData[idx].localSizeX += 0.01; },
          Left: (idx) => { this.boundingBoxEditData[idx].localSizeX -= 0.01; }
        },
        Y: {
          // D.Y adjusts size along local Y axis
          Right: (idx) => { this.boundingBoxEditData[idx].localSizeY += 0.01; },
          Left: (idx) => { this.boundingBoxEditData[idx].localSizeY -= 0.01; }
        },
        Z: {
          // D.Z adjusts size along local Z axis
          Right: (idx) => { this.boundingBoxEditData[idx].localSizeZ += 0.01; },
          Left: (idx) => { this.boundingBoxEditData[idx].localSizeZ -= 0.01; }
        }
      }
    };

    // Map keyboard codes to action keys with explicit typing
    const modeMap: Record<string, ModeName | undefined> = {
      KeyR: 'R',
      KeyC: 'C',
      KeyD: 'D'
    };

    const axisMap: Record<string, AxisName | undefined> = {
      KeyX: 'X',
      KeyY: 'Y',
      KeyZ: 'Z'
    };

    const directionMap: Record<string, DirectionName | undefined> = {
      ArrowRight: 'Right',
      ArrowLeft: 'Left'
    };


    // Define key down handler
    this.keydownListener = (event) => {
      // Update key state
      if (this.keyState.hasOwnProperty(event.code)) {
        this.keyState[event.code] = true;
      }

      // Process all key combinations in a type-safe way
      for (const [modeCode, modeKey] of Object.entries(modeMap)) {
        if (!this.keyState[modeCode] || !modeKey) continue;

        for (const [axisCode, axisKey] of Object.entries(axisMap)) {
          if (!this.keyState[axisCode] || !axisKey) continue;

          for (const [dirCode, dirKey] of Object.entries(directionMap)) {
            if (!this.keyState[dirCode] || !dirKey) continue;

            // Apply the action
            keyActions[modeKey][axisKey][dirKey](this.selectedBoundingBoxIndex);
          }
        }
      }

      this.updateBoundingBox();
    };
    this.keyupListener = (event) => {
      if (this.keyState.hasOwnProperty(event.code)) {
        this.keyState[event.code] = false;
      }
    };

    // Add resize listener to update renderer size
    this.resizeListener = () => {
      const container = this.rendererContainer.nativeElement;
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width > 0 && height > 0) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    };

    // Add event listeners
    window.addEventListener('keydown', this.keydownListener);
    window.addEventListener('keyup', this.keyupListener);
    window.addEventListener('resize', this.resizeListener);
  }

  // Cleanup scene resources when switching between samples (without destroying component)
  private cleanupSceneResources() {
    // Clear any pending timers
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    if (this.render2DThrottleTimer) {
      clearTimeout(this.render2DThrottleTimer);
      this.render2DThrottleTimer = null;
    }

    // Hide toast if visible
    this.toastVisible = false;

    // DON'T clean up 2D canvas event listeners - they are set up once in ngAfterViewInit
    // and should persist across scene changes since the canvas elements don't change
    // this.cleanup2DCanvasListeners(); // REMOVED

    // Reset 2D view states
    this.currentDraggingView = null;
    this.currentDraggingCornerIndex = null;
    this.currentDraggingAngleDelta = 0;

    // Clear point cloud data arrays (will be replaced with new data)
    this.pointCloudPositions = null;
    this.pointCloudColors = null;

    // Note: Don't dispose point cloud and bounding box here -
    // loadPLYFile and loadBoundingBoxFromJSON will handle that
    // Note: Don't remove window event listeners or stop animation -
    // component is still alive, just loading new data
  }

  // Method for disposing elements when component is destroyed
  ngOnDestroy() {
    // Cancel animation frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Remove event listeners
    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }

    if (this.keyupListener) {
      window.removeEventListener('keyup', this.keyupListener);
      this.keyupListener = null;
    }

    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    // Unsubscribe from route subscription
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
      this.routeSubscription = null;
    }

    // Dispose of THREE.js objects
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud);
      this.pointCloud.geometry.dispose();
      (this.pointCloud.material as THREE.Material).dispose();
      this.pointCloud = null;
    }

    if (this.boundingBoxMesh) {
      this.scene.remove(this.boundingBoxMesh);

      // If it's a group, dispose of all children
      if (this.boundingBoxMesh instanceof THREE.Group) {
        this.boundingBoxMesh.children.forEach((child) => {
          if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      } else if (this.boundingBoxMesh instanceof THREE.LineSegments) {
        this.boundingBoxMesh.geometry.dispose();
        (this.boundingBoxMesh.material as THREE.Material).dispose();
      }

      this.boundingBoxMesh = null;
    }

    // Dispose of TrackballControls
    if (this.trackballControls) {
      this.trackballControls.dispose();
    }

    // Remove axesHelper
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
    }

    // Clear the scene
    while (this.scene.children.length > 0) {
      const object = this.scene.children[0];
      this.scene.remove(object);
    }

    // Dispose of renderer
    if (this.renderer) {
      this.renderer.dispose();
      // Clear the DOM element
      if (this.rendererContainer && this.rendererContainer.nativeElement) {
        this.rendererContainer.nativeElement.innerHTML = '';
      }
    }
    // Remove local axes helper if it exists
    const localAxesHelper = this.scene.getObjectByName('localAxesHelper');
    if (localAxesHelper) {
      this.scene.remove(localAxesHelper);
    }

    // Clean up 2D canvas event listeners
    this.cleanup2DCanvasListeners();

    // Clear point cloud data arrays
    this.pointCloudPositions = null;
    this.pointCloudColors = null;

    // Clear 2D canvas contexts
    this.topViewCtx = null;
    this.frontViewCtx = null;
    this.sideViewCtx = null;
  }

  private cleanup2DCanvasListeners() {
    // Helper function to remove all listeners from a canvas
    const removeListeners = (canvas: HTMLCanvasElement | undefined, listenerMap: Map<string, EventListener>) => {
      if (!canvas) return;

      listenerMap.forEach((listener, eventType) => {
        canvas.removeEventListener(eventType, listener);
      });
      listenerMap.clear();
    };

    // Clean up all three canvases
    removeListeners(this.topCanvas?.nativeElement, this.topCanvasListeners);
    removeListeners(this.frontCanvas?.nativeElement, this.frontCanvasListeners);
    removeListeners(this.sideCanvas?.nativeElement, this.sideCanvasListeners);
  }

  // TODO: Color not updating after select
  selectPreviousObject() {
    if (this.canSelectPreviousObject()) {
      this.selectedBoundingBoxIndex = this.selectedBoundingBoxIndex! - 1;
      this.onBoundingBoxSelect();
    }
  }

  selectNextObject() {
    if (this.canSelectNextObject()) {
      this.selectedBoundingBoxIndex = this.selectedBoundingBoxIndex! + 1;
      this.onBoundingBoxSelect();
    }
  }

  canSelectPreviousObject(): boolean {
    return this.selectedBoundingBoxIndex !== null &&
           this.selectedBoundingBoxIndex > 0;
  }

  canSelectNextObject(): boolean {
    return this.selectedBoundingBoxIndex !== null &&
           this.selectedBoundingBoxIndex < this.boundingBoxEditData.length - 1;
  }

  onBoundingBoxSelect() {
    if (!this.boundingBoxMesh || !(this.boundingBoxMesh instanceof THREE.Group)) {
      return;
    }
    // Update the visibility and appearance of the bounding boxes
    const boxGroup = this.boundingBoxMesh as THREE.Group;

    // Go through each child (each bounding box)
    for (let i = 0; i < boxGroup.children.length; i++) {
      const boxGroupItem = boxGroup.children[i] as THREE.Group;
      // The first child of each group is the LineSegments (edges)
      const lineSegments = boxGroupItem.children[0] as THREE.LineSegments;
      const material = lineSegments.material as THREE.LineBasicMaterial;

      if (i === this.selectedBoundingBoxIndex) {
        // Highlight the selected box
        material.color.set(0xff0000); // Red
        material.linewidth = 20;

        // Remove old colored planes if they exist and dispose resources
        while (boxGroupItem.children.length > 1) {
          const planeToRemove = boxGroupItem.children[1];
          if (planeToRemove instanceof THREE.Mesh) {
            if (planeToRemove.geometry) {
              planeToRemove.geometry.dispose();
            }
            if (planeToRemove.material) {
              if (Array.isArray(planeToRemove.material)) {
                planeToRemove.material.forEach(mat => mat.dispose());
              } else {
                planeToRemove.material.dispose();
              }
            }
          }
          boxGroupItem.remove(planeToRemove);
        }

        // Add colored planes to selected box
        const boxData = this.boundingBoxEditData[i];
        const vertices = this.createBoxVerticesFromParams(boxData);

        // XY plane (Top View) - Red semi-transparent
        const xyGeometry = new THREE.BufferGeometry();
        const xyVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[1][0], vertices[1][1], vertices[1][2],
          vertices[2][0], vertices[2][1], vertices[2][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[2][0], vertices[2][1], vertices[2][2],
          vertices[3][0], vertices[3][1], vertices[3][2]
        ]);
        xyGeometry.setAttribute('position', new THREE.BufferAttribute(xyVertices, 3));
        const xyMaterial = new THREE.MeshBasicMaterial({
          color: 0xff6b6b,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const xyPlane = new THREE.Mesh(xyGeometry, xyMaterial);
        boxGroupItem.add(xyPlane);

        // XZ plane (Front View) - Green semi-transparent
        const xzGeometry = new THREE.BufferGeometry();
        const xzVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[1][0], vertices[1][1], vertices[1][2],
          vertices[5][0], vertices[5][1], vertices[5][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[5][0], vertices[5][1], vertices[5][2],
          vertices[4][0], vertices[4][1], vertices[4][2]
        ]);
        xzGeometry.setAttribute('position', new THREE.BufferAttribute(xzVertices, 3));
        const xzMaterial = new THREE.MeshBasicMaterial({
          color: 0x51cf66,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const xzPlane = new THREE.Mesh(xzGeometry, xzMaterial);
        boxGroupItem.add(xzPlane);

        // YZ plane (Side View) - Blue semi-transparent
        const yzGeometry = new THREE.BufferGeometry();
        const yzVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[3][0], vertices[3][1], vertices[3][2],
          vertices[7][0], vertices[7][1], vertices[7][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[7][0], vertices[7][1], vertices[7][2],
          vertices[4][0], vertices[4][1], vertices[4][2]
        ]);
        yzGeometry.setAttribute('position', new THREE.BufferAttribute(yzVertices, 3));
        const yzMaterial = new THREE.MeshBasicMaterial({
          color: 0x339af0,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const yzPlane = new THREE.Mesh(yzGeometry, yzMaterial);
        boxGroupItem.add(yzPlane);
      } else {
        // Make other boxes blue and remove colored planes
        material.color.set(0x1410eb); // purple
        material.linewidth = 10;

        // Remove colored planes from non-selected boxes and dispose resources
        while (boxGroupItem.children.length > 1) {
          const planeToRemove = boxGroupItem.children[1];
          if (planeToRemove instanceof THREE.Mesh) {
            if (planeToRemove.geometry) {
              planeToRemove.geometry.dispose();
            }
            if (planeToRemove.material) {
              if (Array.isArray(planeToRemove.material)) {
                planeToRemove.material.forEach(mat => mat.dispose());
              } else {
                planeToRemove.material.dispose();
              }
            }
          }
          boxGroupItem.remove(planeToRemove);
        }
      }
    }

    // Force material update
    setTimeout(() => {
      this.renderer.render(this.scene, this.camera);
      this.updateLocalAxesHelper();

      // Reset initial box state for all views on new selection
      if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
        const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
        this.updateAllViewsInitialState(box);
      }

      // Recalculate zoom for new box size
      this.calculate2DViewZoom();
      this.render2DViews();

      // Auto-center 3D camera on selected object
      if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
        const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

        // Calculate max dimension of the box
        const maxDim = Math.max(box.localSizeY, box.localSizeZ, box.localSizeX);

        // Calculate appropriate camera distance (same logic as fitCameraToObject)
        const fitHeightDistance = maxDim / (2 * Math.atan(Math.PI / 4));
        const fitWidthDistance = fitHeightDistance / this.camera.aspect;
        const distance = 2.5 * Math.max(fitHeightDistance, fitWidthDistance);

        // Get box center
        const center = new THREE.Vector3(box.centerX, box.centerY, box.centerZ);

        // Update camera position
        this.camera.position.copy(center);
        this.camera.position.z -= distance; // Move camera along Z axis
        this.camera.lookAt(center);

        // Update trackball controls target
        this.trackballControls.target.copy(center);
        this.trackballControls.update();

        // Reposition axes helper to box center
        // this.axesHelper.position.copy(center);
      }
    }, 10);

  }

  private applyLocalRotation(boxIndex: number, axis: 'X' | 'Y' | 'Z', amount: number) {
    const boxData = this.boundingBoxEditData[boxIndex];

    // Create a temporary object to handle the rotations
    const tempObject = new THREE.Object3D();

    // Set initial rotation from boxData
    tempObject.rotation.set(
      boxData.rotationX,
      boxData.rotationY,
      boxData.rotationZ,
      'ZYX'
    );

    // Apply the rotation directly using Object3D's methods
    // This will rotate around the object's local axes
    if (axis === 'X') {
      tempObject.rotateX(amount);
    } else if (axis === 'Y') {
      tempObject.rotateY(amount);
    } else { // Z
      tempObject.rotateZ(amount);
    }

    // The rotateX/Y/Z methods rotate around the local object axes
    // Extract the resulting Euler angles
    boxData.rotationX = tempObject.rotation.x;
    boxData.rotationY = tempObject.rotation.y;
    boxData.rotationZ = tempObject.rotation.z;

    // Sync rotation matrix from Euler angles
    const euler = new THREE.Euler(boxData.rotationX, boxData.rotationY, boxData.rotationZ, 'ZYX');
    boxData.rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

    // Update the bounding box
    this.updateBoundingBox();
  }
  private applyLocalTranslation(boxIndex: number, axis: 'X' | 'Y' | 'Z', amount: number) {
    const boxData = this.boundingBoxEditData[boxIndex];

    // Create a quaternion from the current rotation
    const currentRotation = new THREE.Euler(
      boxData.rotationX,
      boxData.rotationY,
      boxData.rotationZ,
      'ZYX'
    );
    const currentQuaternion = new THREE.Quaternion().setFromEuler(currentRotation);

    // Create a displacement vector in local coordinates
    const displacement = new THREE.Vector3();

    // Set displacement along the appropriate local axis
    if (axis === 'X') {
      displacement.set(amount, 0, 0);
    } else if (axis === 'Y') {
      displacement.set(0, amount, 0);
    } else { // Z
      displacement.set(0, 0, amount);
    }

    // Transform displacement to global coordinates based on current rotation
    displacement.applyQuaternion(currentQuaternion);

    // Apply the transformed displacement to the center position
    boxData.centerX += displacement.x;
    boxData.centerY += displacement.y;
    boxData.centerZ += displacement.z;

    this.updateBoundingBox()
  }
  updateBoundingBox() {
    if (!this.boundingBoxMesh || this.boundingBoxEditData.length === 0) {
      return;
    }

    // Get the selected bounding box data
    const boxData = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

    // Sync rotation matrix from Euler angles (in case user edited Euler angles via input)
    const euler = new THREE.Euler(boxData.rotationX, boxData.rotationY, boxData.rotationZ, 'ZYX');
    boxData.rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

    const vertices = this.createBoxVerticesFromParams(boxData);

    // Update the geometry of the selected bounding box
    if (this.boundingBoxMesh instanceof THREE.Group) {
      // Get the selected box group
      const boxGroup = this.boundingBoxMesh.children[this.selectedBoundingBoxIndex] as THREE.Group;
      // Get the line segments (first child of the group)
      const boxMesh = boxGroup.children[0] as THREE.LineSegments;

      // Update geometry positions
      const positions = boxMesh.geometry.attributes['position'] as THREE.BufferAttribute;

      // Define edges of the bounding box
      const edgeIndices = [
        0, 1, 1, 2, 2, 3, 3, 0,  // First face
        4, 5, 5, 6, 6, 7, 7, 4,  // Second face
        0, 4, 1, 5, 2, 6, 3, 7   // Connecting lines between faces
      ];

      // Update vertex positions
      for (let i = 0; i < edgeIndices.length; i++) {
        const vertexIndex = edgeIndices[i];
        const vertex = vertices[vertexIndex];
        positions.setXYZ(i, vertex[0], vertex[1], vertex[2]);
      }

      positions.needsUpdate = true;
      boxMesh.geometry.computeBoundingSphere();

      // Update colored planes if they exist (for selected box)
      if (boxGroup.children.length > 1) {
        // Remove old planes and dispose resources
        while (boxGroup.children.length > 1) {
          const planeToRemove = boxGroup.children[1];
          if (planeToRemove instanceof THREE.Mesh) {
            if (planeToRemove.geometry) {
              planeToRemove.geometry.dispose();
            }
            if (planeToRemove.material) {
              if (Array.isArray(planeToRemove.material)) {
                planeToRemove.material.forEach(mat => mat.dispose());
              } else {
                planeToRemove.material.dispose();
              }
            }
          }
          boxGroup.remove(planeToRemove);
        }

        // Add updated planes
        // XY plane (Top View) - Red semi-transparent
        const xyGeometry = new THREE.BufferGeometry();
        const xyVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[1][0], vertices[1][1], vertices[1][2],
          vertices[2][0], vertices[2][1], vertices[2][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[2][0], vertices[2][1], vertices[2][2],
          vertices[3][0], vertices[3][1], vertices[3][2]
        ]);
        xyGeometry.setAttribute('position', new THREE.BufferAttribute(xyVertices, 3));
        const xyMaterial = new THREE.MeshBasicMaterial({
          color: 0xff6b6b,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const xyPlane = new THREE.Mesh(xyGeometry, xyMaterial);
        boxGroup.add(xyPlane);

        // XZ plane (Front View) - Green semi-transparent
        const xzGeometry = new THREE.BufferGeometry();
        const xzVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[1][0], vertices[1][1], vertices[1][2],
          vertices[5][0], vertices[5][1], vertices[5][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[5][0], vertices[5][1], vertices[5][2],
          vertices[4][0], vertices[4][1], vertices[4][2]
        ]);
        xzGeometry.setAttribute('position', new THREE.BufferAttribute(xzVertices, 3));
        const xzMaterial = new THREE.MeshBasicMaterial({
          color: 0x51cf66,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const xzPlane = new THREE.Mesh(xzGeometry, xzMaterial);
        boxGroup.add(xzPlane);

        // YZ plane (Side View) - Blue semi-transparent
        const yzGeometry = new THREE.BufferGeometry();
        const yzVertices = new Float32Array([
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[3][0], vertices[3][1], vertices[3][2],
          vertices[7][0], vertices[7][1], vertices[7][2],
          vertices[0][0], vertices[0][1], vertices[0][2],
          vertices[7][0], vertices[7][1], vertices[7][2],
          vertices[4][0], vertices[4][1], vertices[4][2]
        ]);
        yzGeometry.setAttribute('position', new THREE.BufferAttribute(yzVertices, 3));
        const yzMaterial = new THREE.MeshBasicMaterial({
          color: 0x339af0,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });
        const yzPlane = new THREE.Mesh(yzGeometry, yzMaterial);
        boxGroup.add(yzPlane);
      }

      this.updateLocalAxesHelper();

    }

    // Render the updated scene
    this.renderer.render(this.scene, this.camera);

    this.boundingJsonBoxData[this.selectedBoundingBoxIndex].bbox3D_cam = vertices

    this.boundingJsonBoxData = [...this.boundingJsonBoxData]

    // Update 2D views (throttled during drag for performance)
    if (this.currentDraggingView) {
      this.render2DViewsThrottled();
    } else {
      this.render2DViews();
    }
  }


  private calculateBoundingBoxVertices(
    centerX: number, centerY: number, centerZ: number,
    height: number, width: number, length: number,  // Matches Python: [h, w, l]
    rotX: number, rotY: number, rotZ: number
  ): number[][] {
    // Match Python axis mapping: X=l, Y=h, Z=w
    const center = new THREE.Vector3(centerX, centerY, centerZ);
    const halfL = length / 2;  // X
    const halfH = height / 2;  // Y
    const halfW = width / 2;   // Z

    const rotation = new THREE.Euler(rotX, rotY, rotZ, 'ZYX');
    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(rotation);

    // Match Python vertex layout exactly
    const vertices = [
      new THREE.Vector3(-halfL, -halfH, -halfW), // v0
      new THREE.Vector3(halfL, -halfH, -halfW), // v1
      new THREE.Vector3(halfL, halfH, -halfW), // v2
      new THREE.Vector3(-halfL, halfH, -halfW), // v3
      new THREE.Vector3(-halfL, -halfH, halfW), // v4
      new THREE.Vector3(halfL, -halfH, halfW), // v5
      new THREE.Vector3(halfL, halfH, halfW), // v6
      new THREE.Vector3(-halfL, halfH, halfW)  // v7
    ];

    return vertices.map(v => v.clone().applyMatrix4(rotationMatrix).add(center))
      .map(v => [v.x, v.y, v.z]);
  }


  showToast(message: string) {
    // Clear existing timeout if any
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastMessage = message;
    this.toastVisible = true;

    // Auto-hide after 4 seconds
    this.toastTimeout = setTimeout(() => {
      this.hideToast();
    }, 4000);
  }

  hideToast() {
    this.toastVisible = false;
    this.toastMessage = '';
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }

  exportBoundingBoxesToJSON() {
    // Check if annotator name is set
    if (!this.annotatorName.trim()) {
      alert('Please enter your name as the annotator before saving.');
      this.showAnnotatorInput = true;
      return;
    }

    // Calculate annotation duration
    this.annotationEndTime = Date.now();
    this.annotationDuration = (this.annotationEndTime - this.annotationStartTime) / 1000; // Convert to seconds

    for (let i = 0; i < this.boundingJsonBoxData.length; i++) {
      // Use edited box data (from boundingBoxEditData) instead of original
      const editedBox = this.boundingBoxEditData[i];

      // Get center from edited data
      const center = [editedBox.centerX, editedBox.centerY, editedBox.centerZ];

      // Get dimensions from edited data (convert to Python format)
      const length = editedBox.localSizeY;  // Python expects Y as length
      const height = editedBox.localSizeZ;  // Python expects Z as height
      const width = editedBox.localSizeX;   // Python expects X as width

      // Use precise rotation matrix from edited data
      const rotationMatrix = editedBox.rotationMatrix;

      // Calculate vertices from center, dimensions, and rotation matrix
      // Note: calculateBoundingBoxVertices expects (height, width, length) = (Y, Z, X)
      const bbox3D = this.calculateBoundingBoxVertices(
        editedBox.centerX, editedBox.centerY, editedBox.centerZ,
        editedBox.localSizeY, editedBox.localSizeZ, editedBox.localSizeX,
        editedBox.rotationX, editedBox.rotationY, editedBox.rotationZ
      );

      // Update JSON data with edited values
      this.boundingJsonBoxData[i].bbox3D_cam = bbox3D;
      this.boundingJsonBoxData[i].center_cam = center;
      this.boundingJsonBoxData[i].dimensions = [length, height, width];
      this.boundingJsonBoxData[i].R_cam = [
        [rotationMatrix.elements[0], rotationMatrix.elements[4], rotationMatrix.elements[8]],
        [rotationMatrix.elements[1], rotationMatrix.elements[5], rotationMatrix.elements[9]],
        [rotationMatrix.elements[2], rotationMatrix.elements[6], rotationMatrix.elements[10]]
      ];
    }

    // Call the API to save the file on the server
    const jsonContent = JSON.stringify(this.boundingJsonBoxData, null, 2);
    const id = this.decoded_path.split('/')[this.decoded_path.split('/').length - 1];

    // Call the API to save the file on the server
    fetch(`${this.apiBaseUrl}/api/save/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: jsonContent
    })
      .then(response => response.json())
      .then(result => {
        if (result.success) {
          // Save metadata (annotator info + timing)
          const metaData = {
            annotator: this.annotatorName.trim(),
            timestamp: new Date().toISOString(),
            startTime: new Date(this.annotationStartTime).toISOString(),
            endTime: new Date(this.annotationEndTime).toISOString(),
            durationSeconds: parseFloat(this.annotationDuration.toFixed(2)),
            imageId: id,
            boundingBoxCount: this.boundingJsonBoxData.length
          };

          return fetch(`${this.apiBaseUrl}/api/save/${id}/annotation_meta`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(metaData)
          });
        } else {
          throw new Error('Error saving file: ' + result.error);
        }
      })
      .then(response => {
        if (response) {
          return response.json();
        }
        return null;
      })
      .then(metaResult => {
        if (metaResult && metaResult.success) {
          const timeInSeconds = this.annotationDuration.toFixed(2);
          this.showToast(`✓ Saved successfully! Time: <span class="highlight-time">${timeInSeconds}s</span>`);
          // Update annotation status after successful save
          this.isAnnotated = true;
          this.currentAnnotator = this.annotatorName.trim();
        } else if (metaResult) {
          // If metadata save failed but result exists
          this.showToast('File saved but metadata could not be saved: ' + (metaResult.error || 'Unknown error'));
        } else {
          // If metaResult is null (from previous then block)
          this.showToast('✓ File saved successfully!');
          this.isAnnotated = true;
        }
      })
      .catch(error => {
        console.error('Failed to save:', error);
        this.showToast('Failed to save: ' + error.message);
      });
  }

  // code to handle file uploads
  onFileUpload(event: Event, type: string) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    if (type === 'ply') {
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        this.loadPLYFile(arrayBuffer);
      };
    }
    reader.readAsArrayBuffer(file);
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

  private fitCameraToObject(object: THREE.Points | THREE.Group) {
    const boundingBox = new THREE.Box3().setFromObject(object);
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Compute the distance to fit the object
    const fitHeightDistance = maxDim / (2 * Math.atan(Math.PI / 4));
    const fitWidthDistance = fitHeightDistance / this.camera.aspect;
    const distance = 1.5 * Math.max(fitHeightDistance, fitWidthDistance);

    const center = boundingBox.getCenter(new THREE.Vector3());

    // Position camera with 180-degree vertical rotation
    this.camera.position.copy(center);
    this.camera.position.z -= distance; // Move camera to opposite side
    this.camera.up.set(0, -1, 0); // Flip the up vector to rotate view 180 degrees
    this.camera.lookAt(center);

    // Update trackball controls
    this.trackballControls.target.copy(center);
    this.trackballControls.update();

    // Reposition axes helper to object center
    // this.axesHelper.position.copy(center);
  }

  private loadPLYFile(arrayBuffer: ArrayBuffer) {
    // Remove and dispose existing point cloud to prevent memory leaks
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud);
      // Dispose geometry and material
      if (this.pointCloud.geometry) {
        this.pointCloud.geometry.dispose();
      }
      if (this.pointCloud.material) {
        (this.pointCloud.material as THREE.Material).dispose();
      }
      this.pointCloud = null;
    }

    // Create PLY loader
    const loader = new PLYLoader();
    const geometry = loader.parse(arrayBuffer);

    // Apply coordinate transformation to geometry
    const positions = geometry.getAttribute('position');

    // Create arrays to store filtered positions
    const filteredPositions = [];
    const filteredColors = [];

    // Get color attribute if it exists
    const colors = geometry.hasAttribute('color') ? geometry.getAttribute('color') : null;

    // Depth limit
    const MAX_DEPTH = 500;

    // Filter points based on depth (z-coordinate)
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      // Only keep points with depth (z) less than or equal to MAX_DEPTH
      if (Math.abs(z) <= MAX_DEPTH) {
        filteredPositions.push(x, y, z);

        // Also keep the corresponding color if available
        if (colors) {
          filteredColors.push(
            colors.getX(i),
            colors.getY(i),
            colors.getZ(i)
          );
        }
      }
    }

    // Create new geometry with filtered points
    const filteredGeometry = new THREE.BufferGeometry();
    filteredGeometry.setAttribute('position', new THREE.Float32BufferAttribute(filteredPositions, 3));

    // Store point cloud positions and colors for 2D projection
    this.pointCloudPositions = new Float32Array(filteredPositions);
    if (colors && filteredColors.length > 0) {
      this.pointCloudColors = new Float32Array(filteredColors);
    } else {
      this.pointCloudColors = null;
    }

    // Add color attribute if available
    if (colors && filteredColors.length > 0) {
      filteredGeometry.setAttribute('color', new THREE.Float32BufferAttribute(filteredColors, 3));
    }

    // Prepare color material
    let material: THREE.PointsMaterial;

    // Check if filtered geometry has color attribute
    if (filteredGeometry.hasAttribute('color')) {
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
    this.pointCloud = new THREE.Points(filteredGeometry, material);

    // Update point cloud stats
    filteredGeometry.computeBoundingBox();
    const boundingBox = filteredGeometry.boundingBox;
    if (boundingBox) {
      this.pointCloudStats = {
        points: filteredGeometry.attributes['position'].count,
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
  private loadBoundingBoxFromJSON(jsonContent: string) {
    // Remove and dispose existing bounding box to prevent memory leaks
    if (this.boundingBoxMesh) {
      this.scene.remove(this.boundingBoxMesh);

      // Dispose all child geometries and materials if it's a Group
      if (this.boundingBoxMesh instanceof THREE.Group) {
        this.boundingBoxMesh.children.forEach((child) => {
          if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
            if (child.geometry) {
              child.geometry.dispose();
            }
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      } else {
        // Dispose single mesh
        if (this.boundingBoxMesh.geometry) {
          this.boundingBoxMesh.geometry.dispose();
        }
        if (this.boundingBoxMesh.material) {
          if (Array.isArray(this.boundingBoxMesh.material)) {
            this.boundingBoxMesh.material.forEach(mat => mat.dispose());
          } else {
            this.boundingBoxMesh.material.dispose();
          }
        }
      }

      this.boundingBoxMesh = null;
    }

    // Clear existing bounding box data
    this.boundingBoxEditData = [];

    try {
      const data: BoundingBoxData[] = JSON.parse(jsonContent);
      this.boundingJsonBoxData = data;
      if (data.length === 0) {
        console.warn('No bounding box data found in JSON');
        return;
      }

      // Create a group to hold all bounding boxes
      const boxGroup = new THREE.Group();

      // Process all bounding boxes in the file
      for (let i = 0; i < data.length; i++) {
        const bboxData = data[i];

        // Extract vertices from bbox3D_cam
        const bbox3D = bboxData.bbox3D_cam;

        // Store bounding box edit data
        const v0 = new THREE.Vector3(...bbox3D[0]);
        const v1 = new THREE.Vector3(...bbox3D[1]);
        const v3 = new THREE.Vector3(...bbox3D[3]);
        const v4 = new THREE.Vector3(...bbox3D[4]);

        // Axes from v0
        const xAxis = new THREE.Vector3().subVectors(v1, v0).normalize(); // length
        const yAxis = new THREE.Vector3().subVectors(v3, v0).normalize(); // height
        const zAxis = new THREE.Vector3().subVectors(v4, v0).normalize(); // width

        // Reconstruct rotation matrix (3x3)
        const rotationMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const euler = new THREE.Euler().setFromRotationMatrix(rotationMatrix, 'ZYX');

        // Compute center as average of all vertices
        const center = bbox3D.reduce((acc, v) => {
          acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2];
          return acc;
        }, [0, 0, 0]).map(c => c / 8);

        // Compute dimensions from distances
        const width = v1.distanceTo(v0);  // X
        const length = v3.distanceTo(v0);  // Y
        const height = v4.distanceTo(v0);  // Z

        const obj_id = bboxData.obj_id;
        const category_name = bboxData.category_name;

        // Push reconstructed data
        this.boundingBoxEditData.push({
          obj_id,
          category_name,
          centerX: center[0],
          centerY: center[1],
          centerZ: center[2],
          localSizeX: width,   // Size along local X axis
          localSizeY: length,  // Size along local Y axis
          localSizeZ: height,  // Size along local Z axis
          rotationX: euler.x,
          rotationY: euler.y,
          rotationZ: euler.z,
          rotationMatrix: rotationMatrix.clone()  // Store precise rotation matrix
        });

        // Create and add individual bounding box
        const boxMesh = this.createIndividualBoundingBoxMesh(bbox3D, i === 0);
        boxGroup.add(boxMesh);
      }

      // Add the group to the scene
      this.boundingBoxMesh = boxGroup;
      this.scene.add(this.boundingBoxMesh);

      // Set the first box as selected by default
      if (this.boundingBoxEditData.length > 0) {
        this.selectedBoundingBoxIndex = 0;
        this.onBoundingBoxSelect();
      }

    } catch (error) {
      console.error('Error parsing JSON:', error);
    }
  }

  private createIndividualBoundingBoxMesh(vertices: number[][], isSelected: boolean = false): THREE.Group {
    const group = new THREE.Group();

    // Create line edges
    const edgeGeometry = new THREE.BufferGeometry();

    // Define edges of the bounding box
    const edgeIndices = [
      0, 1, 1, 2, 2, 3, 3, 0,  // First face
      4, 5, 5, 6, 6, 7, 7, 4,  // Second face
      0, 4, 1, 5, 2, 6, 3, 7   // Connecting lines between faces
    ];

    // Create flattened array of vertices for the edges
    const positions: number[] = [];

    for (let i = 0; i < edgeIndices.length; i++) {
      const vertexIndex = edgeIndices[i];
      const vertex = vertices[vertexIndex];
      positions.push(vertex[0], vertex[1], vertex[2]);
    }

    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Create material with color based on selection state
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: isSelected ? 0xff0000 : 0x1410eb, // red if selected, blue otherwise
      linewidth: isSelected ? 20 : 10 // Thicker line if selected
    });

    const lineSegments = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    group.add(lineSegments);

    // Only add semi-transparent planes for selected box
    if (isSelected) {
      // Add three semi-transparent planes for the three orthogonal views
      // Vertices layout:
      // Bottom face (XY plane, closer to camera): 0,1,2,3
      // Top face (XY plane, farther from camera): 4,5,6,7

      // XY plane (Top View) - Red semi-transparent
      const xyGeometry = new THREE.BufferGeometry();
      const xyVertices = new Float32Array([
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[1][0], vertices[1][1], vertices[1][2],
        vertices[2][0], vertices[2][1], vertices[2][2],
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[2][0], vertices[2][1], vertices[2][2],
        vertices[3][0], vertices[3][1], vertices[3][2]
      ]);
      xyGeometry.setAttribute('position', new THREE.BufferAttribute(xyVertices, 3));
      const xyMaterial = new THREE.MeshBasicMaterial({
        color: 0xff6b6b,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide
      });
      const xyPlane = new THREE.Mesh(xyGeometry, xyMaterial);
      group.add(xyPlane);

      // XZ plane (Front View) - Green semi-transparent
      const xzGeometry = new THREE.BufferGeometry();
      const xzVertices = new Float32Array([
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[1][0], vertices[1][1], vertices[1][2],
        vertices[5][0], vertices[5][1], vertices[5][2],
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[5][0], vertices[5][1], vertices[5][2],
        vertices[4][0], vertices[4][1], vertices[4][2]
      ]);
      xzGeometry.setAttribute('position', new THREE.BufferAttribute(xzVertices, 3));
      const xzMaterial = new THREE.MeshBasicMaterial({
        color: 0x51cf66,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide
      });
      const xzPlane = new THREE.Mesh(xzGeometry, xzMaterial);
      group.add(xzPlane);

      // YZ plane (Side View) - Blue semi-transparent
      const yzGeometry = new THREE.BufferGeometry();
      const yzVertices = new Float32Array([
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[3][0], vertices[3][1], vertices[3][2],
        vertices[7][0], vertices[7][1], vertices[7][2],
        vertices[0][0], vertices[0][1], vertices[0][2],
        vertices[7][0], vertices[7][1], vertices[7][2],
        vertices[4][0], vertices[4][1], vertices[4][2]
      ]);
      yzGeometry.setAttribute('position', new THREE.BufferAttribute(yzVertices, 3));
      const yzMaterial = new THREE.MeshBasicMaterial({
        color: 0x339af0,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide
      });
      const yzPlane = new THREE.Mesh(yzGeometry, yzMaterial);
      group.add(yzPlane);
    }

    return group;
  }

  createBoxVerticesFromParams(boxData: BoundingBoxEditData): number[][] {
    // calculateBoundingBoxVertices expects (height, width, length) = (Y, Z, X)
    return this.calculateBoundingBoxVertices(
      boxData.centerX, boxData.centerY, boxData.centerZ,
      boxData.localSizeY, boxData.localSizeZ, boxData.localSizeX,
      boxData.rotationX, boxData.rotationY, boxData.rotationZ
    );
  }

  private updateLocalAxesHelper() {
    // Remove existing helper if any
    const existingHelper = this.scene.getObjectByName('localAxesHelper');
    if (existingHelper) this.scene.remove(existingHelper);

    if (this.boundingBoxEditData.length === 0 || this.selectedBoundingBoxIndex < 0) return;

    const boxData = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

    // Create rotation matrix from euler angles
    const rotation = new THREE.Euler(
      boxData.rotationX,
      boxData.rotationY,
      boxData.rotationZ,
      'ZYX'
    );
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);

    // Create axis helpers - use a smaller size than global axes
    const axisLength = Math.max(
      boxData.localSizeX,
      boxData.localSizeY,
      boxData.localSizeZ
    ) * 1.2;

    // Create custom axes helper with thick lines
    const axesGroup = new THREE.Group();
    axesGroup.name = 'localAxesHelper';

    // X axis - blue
    const xAxisGeometry = new THREE.BufferGeometry();
    xAxisGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, axisLength, 0, 0
    ], 3));
    const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff, linewidth: 10 });
    const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);

    // Y axis - green
    const yAxisGeometry = new THREE.BufferGeometry();
    yAxisGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 0, axisLength, 0
    ], 3));
    const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 10 });
    const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);

    // Z axis - red
    const zAxisGeometry = new THREE.BufferGeometry();
    zAxisGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 0, 0, axisLength
    ], 3));
    const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 10 });
    const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);

    // Add axes to group
    axesGroup.add(xAxis);
    axesGroup.add(yAxis);
    axesGroup.add(zAxis);

    // Position and rotate the axes helper
    axesGroup.position.set(boxData.centerX, boxData.centerY, boxData.centerZ);
    axesGroup.quaternion.copy(quaternion);

    this.scene.add(axesGroup);

    // Make sure the scene is rendered
    this.renderer.render(this.scene, this.camera);
  }

  async goToPreviousSample() {
    // Hide toast when switching scenes
    this.hideToast();

    try {
      const currentPath = this.decoded_path;
      const pathParts = currentPath.split('/');
      const currentFolder = pathParts[pathParts.length - 1];

      // Get the current page and folder info from the API
      const response = await fetch(`${this.apiBaseUrl}/api/getindex/${currentFolder}?page=${this.currentPage}&sortBy=${this.sortBy}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      if (!data.success) {
        console.error('Failed to get folder index:', data.error);
        return;
      }

      if (!data.item?.previous) {
        alert('This is the first sample in the list');
        return;
      }

      // Update current page if needed
      this.currentPage = data.currentPage;

      // Navigate to the previous sample with the correct path structure
      const encodedPath = encodeURIComponent(`assets/val/${data.item.previous}`);
      this.router.navigate(['/dashboard', encodedPath, this.type], {
        queryParams: { sortBy: this.sortBy }
      }).then(() => {
        // Check opt-out status after navigation
        this.checkOptOutStatus();
      });
    } catch (error: any) {
      console.error('Error navigating to previous sample:', error);
      alert('Failed to navigate to previous sample: ' + error.message);
    }
  }

  async goToNextSample() {
    // Hide toast when switching scenes
    this.hideToast();

    try {
      const currentPath = this.decoded_path;
      const pathParts = currentPath.split('/');
      const currentFolder = pathParts[pathParts.length - 1];

      // Get the current page and folder info from the API
      const response = await fetch(`${this.apiBaseUrl}/api/getindex/${currentFolder}?page=${this.currentPage}&sortBy=${this.sortBy}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      if (!data.success) {
        console.error('Failed to get folder index:', data.error);
        return;
      }

      if (!data.item?.next) {
        alert('This is the last sample in the list');
        return;
      }

      // Update current page if needed
      this.currentPage = data.currentPage;

      // Navigate to the next sample with the correct path structure
      const encodedPath = encodeURIComponent(`assets/val/${data.item.next}`);
      this.router.navigate(['/dashboard', encodedPath, this.type], {
        queryParams: { sortBy: this.sortBy }
      }).then(() => {
        // Check opt-out status after navigation
        this.checkOptOutStatus();
      });
    } catch (error: any) {
      console.error('Error navigating to next sample:', error);
      alert('Failed to navigate to next sample: ' + error.message);
    }
  }

  async goToNextUnlabeledSample() {
    // Hide toast when switching scenes
    this.hideToast();

    try {
      const currentPath = this.decoded_path;
      const pathParts = currentPath.split('/');
      const currentFolder = pathParts[pathParts.length - 1];

      // Call the new API endpoint
      const response = await fetch(`${this.apiBaseUrl}/api/getnextunlabeled/${currentFolder}?sortBy=${this.sortBy}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        console.error('Failed to find next unlabeled sample:', data.error);
        alert('Failed to find next unlabeled sample');
        return;
      }

      if (!data.nextUnlabeled) {
        alert('No more unlabeled samples found! All samples have been processed.');
        return;
      }

      // Navigate to the next unlabeled sample
      const encodedPath = encodeURIComponent(`assets/val/${data.nextUnlabeled}`);
      this.router.navigate(['/dashboard', encodedPath, this.type], {
        queryParams: { sortBy: this.sortBy }
      }).then(() => {
        this.checkOptOutStatus();
      });

    } catch (error: any) {
      console.error('Error navigating to next unlabeled sample:', error);
      alert('Failed to navigate to next unlabeled sample: ' + error.message);
    }
  }

  goToHome() {
    // Hide toast when switching scenes
    this.hideToast();

    // Navigate to home with current page
    this.router.navigate(['/'], { queryParams: { page: this.currentPage } });
  }

  // ==================== 2D Orthogonal Views ====================

  private init2DViews() {
    // Record initial box state for each view
    if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
      const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
      this.topViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
      this.frontViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
      this.sideViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }

    // Calculate initial zoom based on box dimensions
    this.calculate2DViewZoom();

    // Initialize 2D canvas contexts only if canvases are available
    if (this.topCanvas && this.topCanvas.nativeElement) {
      const canvas = this.topCanvas.nativeElement;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      this.topViewCtx = canvas.getContext('2d');
      this.setup2DViewEvents(canvas, 'top');
    }

    if (this.frontCanvas && this.frontCanvas.nativeElement) {
      const canvas = this.frontCanvas.nativeElement;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      this.frontViewCtx = canvas.getContext('2d');
      this.setup2DViewEvents(canvas, 'front');
    }

    if (this.sideCanvas && this.sideCanvas.nativeElement) {
      const canvas = this.sideCanvas.nativeElement;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      this.sideViewCtx = canvas.getContext('2d');
      this.setup2DViewEvents(canvas, 'side');
    }

    // Initial render
    this.render2DViews();
  }

  private calculate2DViewZoom() {
    if (this.selectedBoundingBoxIndex === null || !this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
      return;
    }

    const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
    const canvasWidth = 400; // Approximate canvas width from CSS
    const canvasHeight = 400; // Approximate canvas height from CSS

    // Target: box should occupy about 50% of the view
    const targetOccupancy = 0.5;

    // Calculate zoom for each view based on box dimensions
    // Zoom = pixels per meter, so larger zoom means bigger display

    // Top View (XY plane) - use X and Y dimensions
    const topMaxDim = Math.max(box.localSizeY, box.localSizeZ);
    this.topViewZoom = (Math.min(canvasWidth, canvasHeight) * targetOccupancy) / topMaxDim;

    // Front View (XZ plane) - use X and Z dimensions
    const frontMaxDim = Math.max(box.localSizeY, box.localSizeX);
    this.frontViewZoom = (Math.min(canvasWidth, canvasHeight) * targetOccupancy) / frontMaxDim;

    // Side View (YZ plane) - use Y and Z dimensions
    const sideMaxDim = Math.max(box.localSizeZ, box.localSizeX);
    this.sideViewZoom = (Math.min(canvasWidth, canvasHeight) * targetOccupancy) / sideMaxDim;

  }

  // Helper method to update all views' initial state to current box state
  private updateAllViewsInitialState(box: BoundingBoxEditData) {
    this.topViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    this.topViewInitialDimensions = { x: box.localSizeY, y: box.localSizeZ, z: box.localSizeX };
    this.frontViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    this.frontViewInitialDimensions = { x: box.localSizeY, y: box.localSizeZ, z: box.localSizeX };
    this.sideViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    this.sideViewInitialDimensions = { x: box.localSizeY, y: box.localSizeZ, z: box.localSizeX };
  }

  // Helper method to set initial center for a specific view
  private setInitialCenterForView(viewType: 'top' | 'front' | 'side', box: BoundingBoxEditData) {
    if (viewType === 'top') {
      this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    } else if (viewType === 'front') {
      this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    } else {
      this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }
  }

  // Helper method to set initial rotation and center for a specific view (used for rotation dragging)
  private setInitialRotationAndCenterForView(viewType: 'top' | 'front' | 'side', box: BoundingBoxEditData) {
    if (viewType === 'top') {
      this.topViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    } else if (viewType === 'front') {
      this.frontViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    } else {
      this.sideViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
      this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }
  }

  // Helper method to reset dragging state and update all views
  private resetDraggingState() {
    if (this.currentDraggingView !== null && this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
      const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
      this.updateAllViewsInitialState(box);
    }

    // Reset dragging state BEFORE rendering so box appears axis-aligned
    this.currentDraggingView = null;
    this.currentDraggingCornerIndex = null;
    this.currentDraggingAngleDelta = 0;

    // Re-render 2D views to show aligned box
    this.render2DViews();
  }

  private setup2DViewEvents(canvas: HTMLCanvasElement, viewType: 'top' | 'front' | 'side') {
    let isPanning = false;
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let lastMousePos = { x: 0, y: 0 };
    let draggedCornerIndex = -1;
    let initialBoxData: BoundingBoxEditData | null = null;
    let initialAngle = 0; // For rotation tracking

    // Get the appropriate listener map for this view
    const listenerMap = viewType === 'top' ? this.topCanvasListeners :
                        viewType === 'front' ? this.frontCanvasListeners :
                        this.sideCanvasListeners;

    // Mouse wheel for zoom
    const wheelListener = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

      if (viewType === 'top') {
        this.topViewZoom *= zoomFactor;
      } else if (viewType === 'front') {
        this.frontViewZoom *= zoomFactor;
      } else if (viewType === 'side') {
        this.sideViewZoom *= zoomFactor;
      }

      this.render2DViews();
    };
    canvas.addEventListener('wheel', wheelListener as EventListener);
    listenerMap.set('wheel', wheelListener as EventListener);

    // Mouse down - check if clicking on corner or center
    const mousedownListener = (e: MouseEvent) => {
      if (e.button === 2) { // Right click for panning
        e.preventDefault();
        isPanning = true;
        lastMousePos = { x: e.offsetX, y: e.offsetY };
      } else if (e.button === 0) { // Left click for dragging
        // Check if clicking on a control point
        const clickedPoint = this.getClickedControlPoint(e.offsetX, e.offsetY, canvas, viewType);
        if (clickedPoint !== null) {
          isDragging = true;
          draggedCornerIndex = clickedPoint;
          dragStartPos = { x: e.offsetX, y: e.offsetY };

          // Set current dragging view and corner index
          this.currentDraggingView = viewType;
          this.currentDraggingCornerIndex = clickedPoint;

          // Store initial box state
          if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
            const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
            initialBoxData = { ...box };

            // If dragging a corner (rotation), calculate initial angle and update initial state
            if (clickedPoint >= 0 && clickedPoint <= 7) {
              // Update the initial state for THIS view (so its point cloud stays fixed during rotation)
              this.setInitialRotationAndCenterForView(viewType, box);
              const pan = viewType === 'top' ? this.topViewPan : (viewType === 'front' ? this.frontViewPan : this.sideViewPan);
              const centerX = canvas.width / 2 + pan.x;
              const centerY = canvas.height / 2 + pan.y;
              // Negate Y because screen Y is down but our coordinate Y is up
              initialAngle = Math.atan2(-(e.offsetY - centerY), e.offsetX - centerX);
            } else if (clickedPoint >= 100 && clickedPoint <= 103) {
              // Dragging edge (dimension adjustment) - no rotation
              this.currentDraggingAngleDelta = 0;
            } else if (clickedPoint === -1) {
              // Dragging center (translation) - no rotation, but set initial center for visual feedback
              this.currentDraggingAngleDelta = 0;
              // Update the initial state for THIS view (so its point cloud stays fixed during translation)
              this.setInitialCenterForView(viewType, box);
            }
          }
        }
      }
    };
    canvas.addEventListener('mousedown', mousedownListener as EventListener);
    listenerMap.set('mousedown', mousedownListener as EventListener);

    const mousemoveListener = (e: MouseEvent) => {
      if (isPanning) {
        const dx = e.offsetX - lastMousePos.x;
        const dy = e.offsetY - lastMousePos.y;

        if (viewType === 'top') {
          this.topViewPan.x += dx;
          this.topViewPan.y += dy;
        } else if (viewType === 'front') {
          this.frontViewPan.x += dx;
          this.frontViewPan.y += dy;
        } else if (viewType === 'side') {
          this.sideViewPan.x += dx;
          this.sideViewPan.y += dy;
        }

        lastMousePos = { x: e.offsetX, y: e.offsetY };
        this.render2DViewsThrottled();
      } else if (isDragging && initialBoxData) {
        const zoom = viewType === 'top' ? this.topViewZoom : (viewType === 'front' ? this.frontViewZoom : this.sideViewZoom);
        const pan = viewType === 'top' ? this.topViewPan : (viewType === 'front' ? this.frontViewPan : this.sideViewPan);

        // If rotating (corner), calculate angle delta
        if (draggedCornerIndex >= 0 && draggedCornerIndex <= 7) {
          const centerX = canvas.width / 2 + pan.x;
          const centerY = canvas.height / 2 + pan.y;
          // Negate Y because screen Y is down but our coordinate Y is up
          const currentAngle = Math.atan2(-(e.offsetY - centerY), e.offsetX - centerX);
          const angleDelta = currentAngle - initialAngle;

          this.updateBoxFrom2DDrag(viewType, draggedCornerIndex, 0, 0, initialBoxData, angleDelta);
        } else {
          // For translation and dimension adjustment, use dx/dy
          const dx = (e.offsetX - dragStartPos.x) / zoom;
          const dy = -(e.offsetY - dragStartPos.y) / zoom; // Flip Y

          this.updateBoxFrom2DDrag(viewType, draggedCornerIndex, dx, dy, initialBoxData, 0);
        }
      } else {
        // Update cursor based on hover
        const hoveredPoint = this.getClickedControlPoint(e.offsetX, e.offsetY, canvas, viewType);
        canvas.style.cursor = hoveredPoint !== null ? 'pointer' : 'crosshair';
      }
    };
    canvas.addEventListener('mousemove', mousemoveListener as EventListener);
    listenerMap.set('mousemove', mousemoveListener as EventListener);

    const mouseupListener = () => {
      isPanning = false;
      isDragging = false;
      draggedCornerIndex = -1;
      initialBoxData = null;

      // Reset dragging state and update all views
      this.resetDraggingState();
    };
    canvas.addEventListener('mouseup', mouseupListener);
    listenerMap.set('mouseup', mouseupListener);

    const mouseleaveListener = () => {
      isPanning = false;
      isDragging = false;
      draggedCornerIndex = -1;
      initialBoxData = null;

      // Reset dragging state and update all views
      this.resetDraggingState();
    };
    canvas.addEventListener('mouseleave', mouseleaveListener);
    listenerMap.set('mouseleave', mouseleaveListener);

    // Prevent context menu
    const contextmenuListener = (e: Event) => {
      e.preventDefault();
    };
    canvas.addEventListener('contextmenu', contextmenuListener);
    listenerMap.set('contextmenu', contextmenuListener);
  }

  private render2DViews() {
    if (this.topViewCtx) {
      this.render2DView(this.topViewCtx, this.topCanvas.nativeElement, 'top', this.topViewZoom, this.topViewPan);
    }
    if (this.frontViewCtx) {
      this.render2DView(this.frontViewCtx, this.frontCanvas.nativeElement, 'front', this.frontViewZoom, this.frontViewPan);
    }
    if (this.sideViewCtx) {
      this.render2DView(this.sideViewCtx, this.sideCanvas.nativeElement, 'side', this.sideViewZoom, this.sideViewPan);
    }
  }

  private render2DViewsThrottled() {
    // Throttle rendering during drag to improve performance
    if (this.render2DThrottleTimer) {
      return; // Skip if already scheduled
    }

    this.render2DThrottleTimer = setTimeout(() => {
      this.render2DViews();
      this.render2DThrottleTimer = null;
    }, 16); // ~60fps max
  }

  alignBoxToAxes() {
    // Align the box to be axis-aligned in 2D views only
    // This updates the reference coordinate system for 2D views
    // without changing the actual 3D box rotation
    if (this.selectedBoundingBoxIndex === null || !this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
      return;
    }

    const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

    // Update all views' initial states to current box state
    // This makes the current rotation become the new "zero" rotation for 2D views
    this.topViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    this.frontViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    this.sideViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };

    // Don't modify the actual box rotation - only update 2D views
    this.render2DViews();
  }

  private render2DView(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    viewType: 'top' | 'front' | 'side',
    zoom: number,
    pan: { x: number, y: number }
  ) {
    // Sync canvas internal dimensions with CSS display size to ensure coordinate consistency
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    this.draw2DGrid(ctx, canvas, zoom, pan);

    // Draw point cloud projection
    if (this.pointCloudPositions) {
      this.draw2DPointCloud(ctx, canvas, viewType, zoom, pan);
    }

    // Draw bounding box projection
    if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData.length > 0) {
      this.draw2DBoundingBox(ctx, canvas, viewType, zoom, pan, this.selectedBoundingBoxIndex);
    }
  }

  private draw2DGrid(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    zoom: number,
    pan: { x: number, y: number }
  ) {
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;

    // Grid follows the box (uses pan)
    const centerX = canvas.width / 2 + pan.x;
    const centerY = canvas.height / 2 + pan.y;

    // Draw grid lines every meter
    const gridSpacing = zoom; // pixels per meter

    // Vertical lines
    for (let i = -20; i <= 20; i++) {
      const x = centerX + i * gridSpacing;
      if (x >= 0 && x <= canvas.width) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
    }

    // Horizontal lines
    for (let i = -20; i <= 20; i++) {
      const y = centerY + i * gridSpacing;
      if (y >= 0 && y <= canvas.height) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // Draw axes (box origin, follows pan)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();

    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);
    ctx.stroke();
  }

  private draw2DPointCloud(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    viewType: 'top' | 'front' | 'side',
    zoom: number,
    pan: { x: number, y: number }
  ) {
    if (!this.pointCloudPositions) return;

    // Determine which coordinate system to use for point cloud:
    // - If THIS view is being dragged: use its initial state (point cloud stays fixed)
    // - Otherwise: use current box state (point cloud follows box with precise rotation matrix)
    let refRotationMatrix: THREE.Matrix4 | null = null;
    let refCenter: { x: number, y: number, z: number } | null = null;
    let refDimensions: { x: number, y: number, z: number } | null = null;

    if (this.currentDraggingView === viewType) {
      // This view is being dragged - use its initial state (point cloud stays fixed)
      // Rebuild from Euler angles (OK because these are fixed initial values)
      let refRotation: { x: number, y: number, z: number } | null = null;
      if (viewType === 'top') {
        refRotation = this.topViewInitialRotation;
        refCenter = this.topViewInitialCenter;
      } else if (viewType === 'front') {
        refRotation = this.frontViewInitialRotation;
        refCenter = this.frontViewInitialCenter;
      } else {
        refRotation = this.sideViewInitialRotation;
        refCenter = this.sideViewInitialCenter;
      }
      if (refRotation) {
        const rotation = new THREE.Euler(refRotation.x, refRotation.y, refRotation.z, 'ZYX');
        refRotationMatrix = new THREE.Matrix4().makeRotationFromEuler(rotation);
      }
      // Use current box dimensions for depth filtering (even while dragging)
      if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
        const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
        refDimensions = { x: box.localSizeX, y: box.localSizeY, z: box.localSizeZ };
      }
    } else {
      // Other views or no dragging - use current box's precise rotation matrix
      if (this.selectedBoundingBoxIndex !== null && this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
        const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];
        refRotationMatrix = box.rotationMatrix;  // Use precise matrix directly!
        refCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
        refDimensions = { x: box.localSizeX, y: box.localSizeY, z: box.localSizeZ };
      }
    }

    if (!refRotationMatrix || !refCenter || !refDimensions) return;

    // Point cloud center with pan offset (same as box rendering)
    const centerX = canvas.width / 2 + pan.x;
    const centerY = canvas.height / 2 + pan.y;

    // Use reference rotation matrix to transform point cloud
    const inverseRotationMatrix = refRotationMatrix.clone().invert();

    // Default color if no color data
    const hasColors = this.pointCloudColors !== null;

    // Sample points for performance (draw every Nth point)
    // Increase sample rate during dragging for better performance
    const sampleRate = this.currentDraggingView ? 4 : 2;

    // Depth filtering ratio (extend beyond box minimum boundary)
    const depthExtensionRatio = 0.2;

    // Calculate depth threshold based on view type
    let depthThreshold = 0;
    if (viewType === 'top') {
      // Top view: only show points with Z > (minZ - extension)
      depthThreshold = -refDimensions.z / 2 - refDimensions.z * depthExtensionRatio;
    } else if (viewType === 'front') {
      // Front view: only show points with Y > (minY - extension)
      depthThreshold = -refDimensions.y / 2 - refDimensions.y * depthExtensionRatio;
    } else if (viewType === 'side') {
      // Side view: only show points with X > (minX - extension)
      depthThreshold = -refDimensions.x / 2 - refDimensions.x * depthExtensionRatio;
    }

    // Pre-extract matrix elements for faster transformation
    const m = inverseRotationMatrix.elements;

    // Set default color once if no colors available
    if (!hasColors) {
      ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
    }

    for (let i = 0; i < this.pointCloudPositions.length; i += 3 * sampleRate) {
      const x = this.pointCloudPositions[i];
      const y = this.pointCloudPositions[i + 1];
      const z = this.pointCloudPositions[i + 2];

      // Transform to reference box local coordinates
      const dx = x - refCenter.x;
      const dy = y - refCenter.y;
      const dz = z - refCenter.z;

      // Manual matrix multiplication (faster than creating Vector3 and calling applyMatrix4)
      const localX = m[0] * dx + m[4] * dy + m[8] * dz;
      const localY = m[1] * dx + m[5] * dy + m[9] * dz;
      const localZ = m[2] * dx + m[6] * dy + m[10] * dz;

      // Apply depth filtering based on view type
      let passDepthFilter = false;
      if (viewType === 'top') {
        passDepthFilter = localZ > depthThreshold;
      } else if (viewType === 'front') {
        passDepthFilter = localY > depthThreshold;
      } else if (viewType === 'side') {
        passDepthFilter = localX > depthThreshold;
      }

      // Skip this point if it doesn't pass the depth filter
      if (!passDepthFilter) continue;

      let screenX = 0;
      let screenY = 0;

      // Project based on view type (now in box local coordinates)
      if (viewType === 'top') {
        // XY plane (looking down Z axis)
        screenX = centerX + localX * zoom;
        screenY = centerY - localY * zoom; // Flip Y for screen coordinates
      } else if (viewType === 'front') {
        // XZ plane (looking along Y axis)
        screenX = centerX + localX * zoom;
        screenY = centerY - localZ * zoom;
      } else if (viewType === 'side') {
        // YZ plane (looking along X axis)
        screenX = centerX + localY * zoom;
        screenY = centerY - localZ * zoom;
      }

      // Only draw points within canvas bounds
      if (screenX >= 0 && screenX <= canvas.width && screenY >= 0 && screenY <= canvas.height) {
        // Set color per point only if colors are available
        if (hasColors && this.pointCloudColors) {
          const r = Math.floor(this.pointCloudColors[i] * 255);
          const g = Math.floor(this.pointCloudColors[i + 1] * 255);
          const b = Math.floor(this.pointCloudColors[i + 2] * 255);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        }
        ctx.fillRect(screenX - 1, screenY - 1, 3, 3); // 3x3 pixels, centered
      }
    }
  }

  private draw2DBoundingBox(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    viewType: 'top' | 'front' | 'side',
    zoom: number,
    pan: { x: number, y: number },
    boxIndex: number
  ) {
    const box = this.boundingBoxEditData[boxIndex];
    if (!box) return;

    const centerX = canvas.width / 2 + pan.x;
    const centerY = canvas.height / 2 + pan.y;

    // Get reference center for this view (like point cloud does)
    // Strategy: Use initial center for dragging view, current center for other views
    let refCenter: { x: number, y: number, z: number } | null = null;

    if (this.currentDraggingView === viewType) {
      // This view is being dragged - use initial center
      if (viewType === 'top') {
        refCenter = this.topViewInitialCenter;
      } else if (viewType === 'front') {
        refCenter = this.frontViewInitialCenter;
      } else {
        refCenter = this.sideViewInitialCenter;
      }
    } else {
      // Other views or no dragging - use current box center (like point cloud)
      refCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }

    // If no reference center, use box center as reference (no offset)
    if (!refCenter) {
      refCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }

    // Calculate box center offset from reference center (in world coordinates)
    const centerOffsetWorld = new THREE.Vector3(
      box.centerX - refCenter.x,
      box.centerY - refCenter.y,
      box.centerZ - refCenter.z
    );

    // Get reference rotation to transform centerOffset to box local coordinates
    let refRotation: { x: number, y: number, z: number } | null = null;
    if (this.currentDraggingView === viewType) {
      // Dragging view: use initial rotation
      if (viewType === 'top') {
        refRotation = this.topViewInitialRotation;
      } else if (viewType === 'front') {
        refRotation = this.frontViewInitialRotation;
      } else {
        refRotation = this.sideViewInitialRotation;
      }
    } else {
      // Other views: use current rotation
      refRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
    }

    // Transform centerOffset from world coordinates to box local coordinates
    let centerOffsetLocal = new THREE.Vector3(0, 0, 0);
    if (refRotation) {
      const refRotEuler = new THREE.Euler(refRotation.x, refRotation.y, refRotation.z, 'ZYX');
      const refRotMatrix = new THREE.Matrix4().makeRotationFromEuler(refRotEuler);
      const inverseRefRotMatrix = refRotMatrix.clone().invert();
      centerOffsetLocal = centerOffsetWorld.clone();
      centerOffsetLocal.applyMatrix4(inverseRefRotMatrix);
    }

    // Extract local offset components for projection
    const centerOffsetX = centerOffsetLocal.x;
    const centerOffsetY = centerOffsetLocal.y;
    const centerOffsetZ = centerOffsetLocal.z;

    // Calculate relative rotation for display
    // Strategy: If this view is currently being dragged, use the exact mouse drag angle (angleDelta)
    // Otherwise, force relativeRotation = 0 to keep box axis-aligned (realigned state)
    let relativeRotation = 0;

    if (this.currentDraggingView === viewType) {
      // This view is being dragged - use actual mouse drag angle for precise visual feedback
      relativeRotation = this.currentDraggingAngleDelta;
    } else {
      // Not being dragged - box should be axis-aligned (relativeRotation = 0)
      // Don't use Euler angle difference because extracted Euler angles may be imprecise
      relativeRotation = 0;
    }

    // Apply only the relative rotation for this view to keep projection 2D
    let view2DRotation: THREE.Euler;
    if (viewType === 'top') {
      view2DRotation = new THREE.Euler(0, 0, relativeRotation, 'ZYX');
    } else if (viewType === 'front') {
      view2DRotation = new THREE.Euler(0, relativeRotation, 0, 'ZYX');
    } else {
      view2DRotation = new THREE.Euler(relativeRotation, 0, 0, 'ZYX');
    }
    const view2DRotMatrix = new THREE.Matrix4().makeRotationFromEuler(view2DRotation);

    // Box dimensions with correct axis mapping
    // World coordinate mapping: X=localSizeX, Y=localSizeY, Z=localSizeZ
    // Strategy: Dragging view adjusts only the dragged edge, keeping opposite edge fixed
    //           Other views use current dimensions (show actual box size)
    let boxCorners: number[][];

    if (this.currentDraggingView === viewType &&
        this.currentDraggingCornerIndex !== null &&
        this.currentDraggingCornerIndex >= 100 && this.currentDraggingCornerIndex <= 103) {
      // Dragging an edge in this view: use asymmetric corners
      const edgeIndex = this.currentDraggingCornerIndex - 100;

      // Get initial and current dimensions
      let initialDimensions: { x: number, y: number, z: number } | null = null;
      if (viewType === 'top') {
        initialDimensions = this.topViewInitialDimensions;
      } else if (viewType === 'front') {
        initialDimensions = this.frontViewInitialDimensions;
      } else {
        initialDimensions = this.sideViewInitialDimensions;
      }

      if (!initialDimensions) {
        // Fallback: use symmetric corners
        const halfX = box.localSizeX / 2;
        const halfY = box.localSizeY / 2;
        const halfZ = box.localSizeZ / 2;
        boxCorners = [
          [-halfX, -halfY, -halfZ], [halfX, -halfY, -halfZ],
          [halfX, halfY, -halfZ],   [-halfX, halfY, -halfZ],
          [-halfX, -halfY, halfZ],  [halfX, -halfY, halfZ],
          [halfX, halfY, halfZ],    [-halfX, halfY, halfZ]
        ];
      } else {
        // Calculate dimension changes
        const deltaX = box.localSizeY - initialDimensions.x;
        const deltaY = box.localSizeZ - initialDimensions.y;
        const deltaZ = box.localSizeX - initialDimensions.z;

        // Initial half dimensions
        const initHalfX = initialDimensions.z / 2;
        const initHalfY = initialDimensions.x / 2;
        const initHalfZ = initialDimensions.y / 2;

        // Build asymmetric corners based on which edge is being dragged
        if (viewType === 'top') {
          // Top view edges: 0=bottom(Y-), 1=right(X+), 2=top(Y+), 3=left(X-)
          if (edgeIndex === 0) {
            // Bottom edge dragged: adjust Y- side
            boxCorners = [
              [-initHalfX, -initHalfY - deltaX, -initHalfZ], [initHalfX, -initHalfY - deltaX, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],             [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY - deltaX, initHalfZ],  [initHalfX, -initHalfY - deltaX, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],             [-initHalfX, initHalfY, initHalfZ]
            ];
          } else if (edgeIndex === 1) {
            // Right edge dragged: adjust X+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ], [initHalfX + deltaZ, -initHalfY, -initHalfZ],
              [initHalfX + deltaZ, initHalfY, -initHalfZ], [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ],  [initHalfX + deltaZ, -initHalfY, initHalfZ],
              [initHalfX + deltaZ, initHalfY, initHalfZ], [-initHalfX, initHalfY, initHalfZ]
            ];
          } else if (edgeIndex === 2) {
            // Top edge dragged: adjust Y+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ],             [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY + deltaX, -initHalfZ],     [-initHalfX, initHalfY + deltaX, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ],              [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY + deltaX, initHalfZ],      [-initHalfX, initHalfY + deltaX, initHalfZ]
            ];
          } else {
            // Left edge dragged: adjust X- side
            boxCorners = [
              [-initHalfX - deltaZ, -initHalfY, -initHalfZ], [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],             [-initHalfX - deltaZ, initHalfY, -initHalfZ],
              [-initHalfX - deltaZ, -initHalfY, initHalfZ],  [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],             [-initHalfX - deltaZ, initHalfY, initHalfZ]
            ];
          }
        } else if (viewType === 'front') {
          // Front view edges: 0=bottom(Z-), 1=right(X+), 2=top(Z+), 3=left(X-)
          if (edgeIndex === 0) {
            // Bottom edge dragged: adjust Z- side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ - deltaY], [initHalfX, -initHalfY, -initHalfZ - deltaY],
              [initHalfX, initHalfY, -initHalfZ - deltaY],   [-initHalfX, initHalfY, -initHalfZ - deltaY],
              [-initHalfX, -initHalfY, initHalfZ],            [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],              [-initHalfX, initHalfY, initHalfZ]
            ];
          } else if (edgeIndex === 1) {
            // Right edge dragged: adjust X+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ], [initHalfX + deltaZ, -initHalfY, -initHalfZ],
              [initHalfX + deltaZ, initHalfY, -initHalfZ], [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ],  [initHalfX + deltaZ, -initHalfY, initHalfZ],
              [initHalfX + deltaZ, initHalfY, initHalfZ], [-initHalfX, initHalfY, initHalfZ]
            ];
          } else if (edgeIndex === 2) {
            // Top edge dragged: adjust Z+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ],          [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],            [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ + deltaY],  [initHalfX, -initHalfY, initHalfZ + deltaY],
              [initHalfX, initHalfY, initHalfZ + deltaY],    [-initHalfX, initHalfY, initHalfZ + deltaY]
            ];
          } else {
            // Left edge dragged: adjust X- side
            boxCorners = [
              [-initHalfX - deltaZ, -initHalfY, -initHalfZ], [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],             [-initHalfX - deltaZ, initHalfY, -initHalfZ],
              [-initHalfX - deltaZ, -initHalfY, initHalfZ],  [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],             [-initHalfX - deltaZ, initHalfY, initHalfZ]
            ];
          }
        } else {
          // Side view edges: 0=bottom(Z-), 1=right(Y+), 2=top(Z+), 3=left(Y-)
          if (edgeIndex === 0) {
            // Bottom edge dragged: adjust Z- side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ - deltaY], [initHalfX, -initHalfY, -initHalfZ - deltaY],
              [initHalfX, initHalfY, -initHalfZ - deltaY],   [-initHalfX, initHalfY, -initHalfZ - deltaY],
              [-initHalfX, -initHalfY, initHalfZ],            [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],              [-initHalfX, initHalfY, initHalfZ]
            ];
          } else if (edgeIndex === 1) {
            // Right edge dragged: adjust Y+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ],             [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY + deltaX, -initHalfZ],     [-initHalfX, initHalfY + deltaX, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ],              [initHalfX, -initHalfY, initHalfZ],
              [initHalfX, initHalfY + deltaX, initHalfZ],      [-initHalfX, initHalfY + deltaX, initHalfZ]
            ];
          } else if (edgeIndex === 2) {
            // Top edge dragged: adjust Z+ side
            boxCorners = [
              [-initHalfX, -initHalfY, -initHalfZ],          [initHalfX, -initHalfY, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],            [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY, initHalfZ + deltaY],  [initHalfX, -initHalfY, initHalfZ + deltaY],
              [initHalfX, initHalfY, initHalfZ + deltaY],    [-initHalfX, initHalfY, initHalfZ + deltaY]
            ];
          } else {
            // Left edge dragged: adjust Y- side
            boxCorners = [
              [-initHalfX, -initHalfY - deltaX, -initHalfZ], [initHalfX, -initHalfY - deltaX, -initHalfZ],
              [initHalfX, initHalfY, -initHalfZ],             [-initHalfX, initHalfY, -initHalfZ],
              [-initHalfX, -initHalfY - deltaX, initHalfZ],  [initHalfX, -initHalfY - deltaX, initHalfZ],
              [initHalfX, initHalfY, initHalfZ],             [-initHalfX, initHalfY, initHalfZ]
            ];
          }
        }
      }
    } else {
      // Other views or not dragging edge: use symmetric corners with current dimensions
      const halfX = box.localSizeX / 2;
      const halfY = box.localSizeY / 2;
      const halfZ = box.localSizeZ / 2;
      boxCorners = [
        [-halfX, -halfY, -halfZ], [halfX, -halfY, -halfZ],
        [halfX, halfY, -halfZ],   [-halfX, halfY, -halfZ],
        [-halfX, -halfY, halfZ],  [halfX, -halfY, halfZ],
        [halfX, halfY, halfZ],    [-halfX, halfY, halfZ]
      ];
    }

    // Apply view-specific 2D rotation
    const localCorners = boxCorners.map((corner) => {
      const vec = new THREE.Vector3(corner[0], corner[1], corner[2]);
      vec.applyMatrix4(view2DRotMatrix);
      return [vec.x, vec.y, vec.z];
    });

    // Project corners to 2D based on view type
    // Strategy:
    //   - For center dragging: always use centerOffset (box moves relative to fixed point cloud in dragging view)
    //   - For edge/rotation dragging: dragging view uses no offset, other views use offset
    const isDraggingCenter = this.currentDraggingCornerIndex === -1;
    const projectedCorners = localCorners.map((corner: number[]) => {
      const [x, y, z] = corner;
      let x2d = 0;
      let y2d = 0;

      if (viewType === 'top') {
        // XY plane
        if (this.currentDraggingView === viewType && !isDraggingCenter) {
          // Dragging view for edge/rotation: project directly without center offset
          x2d = centerX + x * zoom;
          y2d = centerY - y * zoom;
        } else {
          // Center dragging or other views: use center offset
          x2d = centerX + (centerOffsetX + x) * zoom;
          y2d = centerY - (centerOffsetY + y) * zoom;
        }
      } else if (viewType === 'front') {
        // XZ plane
        if (this.currentDraggingView === viewType && !isDraggingCenter) {
          // Dragging view for edge/rotation: project directly without center offset
          x2d = centerX + x * zoom;
          y2d = centerY - z * zoom;
        } else {
          // Center dragging or other views: use center offset
          x2d = centerX + (centerOffsetX + x) * zoom;
          y2d = centerY - (centerOffsetZ + z) * zoom;
        }
      } else if (viewType === 'side') {
        // YZ plane
        if (this.currentDraggingView === viewType && !isDraggingCenter) {
          // Dragging view for edge/rotation: project directly without center offset
          x2d = centerX + y * zoom;
          y2d = centerY - z * zoom;
        } else {
          // Center dragging or other views: use center offset
          x2d = centerX + (centerOffsetY + y) * zoom;
          y2d = centerY - (centerOffsetZ + z) * zoom;
        }
      }

      return [x2d, y2d];
    });

    // Draw bounding box edges
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;

    // Define edges
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], // Bottom face
      [4, 5], [5, 6], [6, 7], [7, 4], // Top face
      [0, 4], [1, 5], [2, 6], [3, 7]  // Vertical edges
    ];

    edges.forEach(([start, end]) => {
      ctx.beginPath();
      ctx.moveTo(projectedCorners[start][0], projectedCorners[start][1]);
      ctx.lineTo(projectedCorners[end][0], projectedCorners[end][1]);
      ctx.stroke();
    });

    // Draw corner control points (for rotation)
    ctx.fillStyle = '#ff00ff'; // Magenta for rotation
    projectedCorners.forEach((corner: number[]) => {
      ctx.beginPath();
      ctx.arc(corner[0], corner[1], 6, 0, 2 * Math.PI);
      ctx.fill();
      // Draw a small rotation indicator
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(corner[0], corner[1], 4, 0, Math.PI * 1.5);
      ctx.stroke();
    });

    // Calculate and draw edge midpoints (for dimension adjustment)
    const edgeMidpoints: number[][] = [];

    if (viewType === 'top') {
      // In top view, we care about bottom face edges (4 edges on XY plane)
      edgeMidpoints.push([
        (projectedCorners[0][0] + projectedCorners[1][0]) / 2,
        (projectedCorners[0][1] + projectedCorners[1][1]) / 2
      ]); // Bottom edge (X direction)
      edgeMidpoints.push([
        (projectedCorners[1][0] + projectedCorners[2][0]) / 2,
        (projectedCorners[1][1] + projectedCorners[2][1]) / 2
      ]); // Right edge (Y direction)
      edgeMidpoints.push([
        (projectedCorners[2][0] + projectedCorners[3][0]) / 2,
        (projectedCorners[2][1] + projectedCorners[3][1]) / 2
      ]); // Top edge (X direction)
      edgeMidpoints.push([
        (projectedCorners[3][0] + projectedCorners[0][0]) / 2,
        (projectedCorners[3][1] + projectedCorners[0][1]) / 2
      ]); // Left edge (Y direction)
    } else if (viewType === 'front') {
      // In front view, edges on XZ plane
      edgeMidpoints.push([
        (projectedCorners[0][0] + projectedCorners[1][0]) / 2,
        (projectedCorners[0][1] + projectedCorners[1][1]) / 2
      ]); // Bottom edge (X direction)
      edgeMidpoints.push([
        (projectedCorners[1][0] + projectedCorners[5][0]) / 2,
        (projectedCorners[1][1] + projectedCorners[5][1]) / 2
      ]); // Right edge (Z direction)
      edgeMidpoints.push([
        (projectedCorners[4][0] + projectedCorners[5][0]) / 2,
        (projectedCorners[4][1] + projectedCorners[5][1]) / 2
      ]); // Top edge (X direction)
      edgeMidpoints.push([
        (projectedCorners[0][0] + projectedCorners[4][0]) / 2,
        (projectedCorners[0][1] + projectedCorners[4][1]) / 2
      ]); // Left edge (Z direction)
    } else {
      // In side view, edges on YZ plane
      edgeMidpoints.push([
        (projectedCorners[0][0] + projectedCorners[3][0]) / 2,
        (projectedCorners[0][1] + projectedCorners[3][1]) / 2
      ]); // Bottom edge (Y direction)
      edgeMidpoints.push([
        (projectedCorners[3][0] + projectedCorners[7][0]) / 2,
        (projectedCorners[3][1] + projectedCorners[7][1]) / 2
      ]); // Right edge (Z direction)
      edgeMidpoints.push([
        (projectedCorners[4][0] + projectedCorners[7][0]) / 2,
        (projectedCorners[4][1] + projectedCorners[7][1]) / 2
      ]); // Top edge (Y direction)
      edgeMidpoints.push([
        (projectedCorners[0][0] + projectedCorners[4][0]) / 2,
        (projectedCorners[0][1] + projectedCorners[4][1]) / 2
      ]); // Left edge (Z direction)
    }

    // Draw edge midpoint controls (for dimension adjustment)
    ctx.fillStyle = '#0000ff'; // Blue for dimension
    edgeMidpoints.forEach((midpoint: number[]) => {
      ctx.beginPath();
      ctx.arc(midpoint[0], midpoint[1], 7, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw center point (for translation) - at box center projection
    // Strategy:
    //   - For center dragging: always use centerOffset (center moves relative to fixed point cloud in dragging view)
    //   - For edge/rotation dragging: dragging view shows center at origin (no offset)
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    let boxCenterX = centerX;
    let boxCenterY = centerY;

    if (this.currentDraggingView === viewType && !isDraggingCenter) {
      // Dragging view for edge/rotation: center stays at canvas center (no offset)
      boxCenterX = centerX;
      boxCenterY = centerY;
    } else {
      // Center dragging or other views: center follows box position (with offset)
      if (viewType === 'top') {
        boxCenterX = centerX + centerOffsetX * zoom;
        boxCenterY = centerY - centerOffsetY * zoom;
      } else if (viewType === 'front') {
        boxCenterX = centerX + centerOffsetX * zoom;
        boxCenterY = centerY - centerOffsetZ * zoom;
      } else {
        boxCenterX = centerX + centerOffsetY * zoom;
        boxCenterY = centerY - centerOffsetZ * zoom;
      }
    }
    ctx.arc(boxCenterX, boxCenterY, 6, 0, 2 * Math.PI);
    ctx.fill();
  }

  private getClickedControlPoint(
    mouseX: number, mouseY: number,
    canvas: HTMLCanvasElement,
    viewType: 'top' | 'front' | 'side'
  ): number | null {
    if (this.selectedBoundingBoxIndex === null || !this.boundingBoxEditData[this.selectedBoundingBoxIndex]) {
      return null;
    }

    const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

    const zoom = viewType === 'top' ? this.topViewZoom : (viewType === 'front' ? this.frontViewZoom : this.sideViewZoom);
    const pan = viewType === 'top' ? this.topViewPan : (viewType === 'front' ? this.frontViewPan : this.sideViewPan);
    const centerX = canvas.width / 2 + pan.x;
    const centerY = canvas.height / 2 + pan.y;

    // Get reference center for this view (same as draw function)
    // Strategy: Use initial center for dragging view, current center for other views
    let refCenter: { x: number, y: number, z: number } | null = null;

    if (this.currentDraggingView === viewType) {
      // This view is being dragged - use initial center
      if (viewType === 'top') {
        refCenter = this.topViewInitialCenter;
      } else if (viewType === 'front') {
        refCenter = this.frontViewInitialCenter;
      } else {
        refCenter = this.sideViewInitialCenter;
      }
    } else {
      // Other views or no dragging - use current box center (like point cloud)
      refCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }

    // If no reference center, use box center as reference (no offset)
    if (!refCenter) {
      refCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
    }

    // Calculate box center offset from reference center
    const centerOffsetX = box.centerX - refCenter.x;
    const centerOffsetY = box.centerY - refCenter.y;
    const centerOffsetZ = box.centerZ - refCenter.z;

    // Calculate relative rotation (same as draw2DBoundingBox)
    let relativeRotation = 0;

    if (this.currentDraggingView === viewType) {
      // This view is being dragged - use actual mouse drag angle for precise visual feedback
      relativeRotation = this.currentDraggingAngleDelta;
    } else {
      // Not being dragged - box should be axis-aligned (relativeRotation = 0)
      // Don't use Euler angle difference because extracted Euler angles may be imprecise
      relativeRotation = 0;
    }

    // Apply only the relative rotation for this view to keep projection 2D
    let view2DRotation: THREE.Euler;
    if (viewType === 'top') {
      view2DRotation = new THREE.Euler(0, 0, relativeRotation, 'ZYX');
    } else if (viewType === 'front') {
      view2DRotation = new THREE.Euler(0, relativeRotation, 0, 'ZYX');
    } else {
      view2DRotation = new THREE.Euler(relativeRotation, 0, 0, 'ZYX');
    }
    const view2DRotMatrix = new THREE.Matrix4().makeRotationFromEuler(view2DRotation);

    // Define corners in box's own coordinate system with correct axis mapping
    // World coordinate mapping: X=localSizeX, Y=localSizeY, Z=localSizeZ
    const halfX = box.localSizeX / 2;  // X axis uses localSizeX
    const halfY = box.localSizeY / 2;  // Y axis uses localSizeY
    const halfZ = box.localSizeZ / 2;  // Z axis uses localSizeZ

    const boxCorners = [
      [-halfX, -halfY, -halfZ], // 0
      [halfX, -halfY, -halfZ],  // 1
      [halfX, halfY, -halfZ],   // 2
      [-halfX, halfY, -halfZ],  // 3
      [-halfX, -halfY, halfZ],  // 4
      [halfX, -halfY, halfZ],   // 5
      [halfX, halfY, halfZ],    // 6
      [-halfX, halfY, halfZ]    // 7
    ];

    // Apply view-specific 2D rotation
    const localCorners = boxCorners.map((corner) => {
      const vec = new THREE.Vector3(corner[0], corner[1], corner[2]);
      vec.applyMatrix4(view2DRotMatrix);
      return [vec.x, vec.y, vec.z];
    });

    // Project corners to 2D (add center offset like draw function)
    const projectedCorners = localCorners.map((corner: number[]) => {
      const [x, y, z] = corner;
      let x2d = 0;
      let y2d = 0;

      if (viewType === 'top') {
        x2d = centerX + (centerOffsetX + x) * zoom;
        y2d = centerY - (centerOffsetY + y) * zoom;
      } else if (viewType === 'front') {
        x2d = centerX + (centerOffsetX + x) * zoom;
        y2d = centerY - (centerOffsetZ + z) * zoom;
      } else if (viewType === 'side') {
        x2d = centerX + (centerOffsetY + y) * zoom;
        y2d = centerY - (centerOffsetZ + z) * zoom;
      }

      return [x2d, y2d];
    });

    const threshold = 15; // Increased for easier edge midpoint detection

    // Calculate edge midpoints (same logic as in draw function)
    const edgeMidpoints: number[][] = [];
    if (viewType === 'top') {
      edgeMidpoints.push([(projectedCorners[0][0] + projectedCorners[1][0]) / 2, (projectedCorners[0][1] + projectedCorners[1][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[1][0] + projectedCorners[2][0]) / 2, (projectedCorners[1][1] + projectedCorners[2][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[2][0] + projectedCorners[3][0]) / 2, (projectedCorners[2][1] + projectedCorners[3][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[3][0] + projectedCorners[0][0]) / 2, (projectedCorners[3][1] + projectedCorners[0][1]) / 2]);
    } else if (viewType === 'front') {
      edgeMidpoints.push([(projectedCorners[0][0] + projectedCorners[1][0]) / 2, (projectedCorners[0][1] + projectedCorners[1][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[1][0] + projectedCorners[5][0]) / 2, (projectedCorners[1][1] + projectedCorners[5][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[4][0] + projectedCorners[5][0]) / 2, (projectedCorners[4][1] + projectedCorners[5][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[0][0] + projectedCorners[4][0]) / 2, (projectedCorners[0][1] + projectedCorners[4][1]) / 2]);
    } else {
      edgeMidpoints.push([(projectedCorners[0][0] + projectedCorners[3][0]) / 2, (projectedCorners[0][1] + projectedCorners[3][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[3][0] + projectedCorners[7][0]) / 2, (projectedCorners[3][1] + projectedCorners[7][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[4][0] + projectedCorners[7][0]) / 2, (projectedCorners[4][1] + projectedCorners[7][1]) / 2]);
      edgeMidpoints.push([(projectedCorners[0][0] + projectedCorners[4][0]) / 2, (projectedCorners[0][1] + projectedCorners[4][1]) / 2]);
    }

    // Check edge midpoints first (for dimension adjustment) - return value 100+
    for (let i = 0; i < edgeMidpoints.length; i++) {
      const [x, y] = edgeMidpoints[i];
      const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
      if (dist < threshold) {
        return 100 + i; // 100-103 for edge midpoints
      }
    }

    // Check corners (for rotation) - return value 0-7
    for (let i = 0; i < projectedCorners.length; i++) {
      const [x, y] = projectedCorners[i];
      const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
      if (dist < threshold) {
        return i; // 0-7 for corners (rotation)
      }
    }

    // Check if mouse is near center point (for translation) - at box center projection
    let boxCenterX = centerX;
    let boxCenterY = centerY;
    if (viewType === 'top') {
      boxCenterX = centerX + centerOffsetX * zoom;
      boxCenterY = centerY - centerOffsetY * zoom;
    } else if (viewType === 'front') {
      boxCenterX = centerX + centerOffsetX * zoom;
      boxCenterY = centerY - centerOffsetZ * zoom;
    } else {
      boxCenterX = centerX + centerOffsetY * zoom;
      boxCenterY = centerY - centerOffsetZ * zoom;
    }
    const distToCenter = Math.sqrt((mouseX - boxCenterX) ** 2 + (mouseY - boxCenterY) ** 2);
    if (distToCenter < threshold) {
      return -1; // Special value for center
    }

    return null;
  }

  private updateBoxFrom2DDrag(
    viewType: 'top' | 'front' | 'side',
    cornerIndex: number,
    dx: number,
    dy: number,
    initialBoxData: BoundingBoxEditData,
    angleDelta: number = 0
  ) {
    if (this.selectedBoundingBoxIndex === null) return;

    const box = this.boundingBoxEditData[this.selectedBoundingBoxIndex];

    if (cornerIndex === -1) {
      // Dragging center - translate the box
      // Screen coordinates in 2D view directly correspond to box local coordinates
      // Translation is constrained to the view plane (local coordinate plane)

      // Get the box's rotation matrix to transform local motion to world coordinates
      const boxRotation = new THREE.Euler(
        initialBoxData.rotationX,
        initialBoxData.rotationY,
        initialBoxData.rotationZ,
        'ZYX'
      );
      const boxRotMatrix = new THREE.Matrix4().makeRotationFromEuler(boxRotation);

      // Screen drag (dx, dy) directly maps to box local coordinate delta
      // The 2D view displays box local coordinates, so screen motion corresponds to local motion
      let deltaLocal = new THREE.Vector3();
      if (viewType === 'top') {
        // Top view shows local XY plane: dx->local X, dy->local Y, constrained to Z=0
        deltaLocal.set(dx, dy, 0);
      } else if (viewType === 'front') {
        // Front view shows local XZ plane: dx->local X, dy->local Z, constrained to Y=0
        deltaLocal.set(dx, 0, dy);
      } else { // side
        // Side view shows local YZ plane: dx->local Y, dy->local Z, constrained to X=0
        deltaLocal.set(0, dx, dy);
      }

      // Transform local coordinate delta to world coordinates
      deltaLocal.applyMatrix4(boxRotMatrix);

      // Apply the translation in world coordinates
      box.centerX = initialBoxData.centerX + deltaLocal.x;
      box.centerY = initialBoxData.centerY + deltaLocal.y;
      box.centerZ = initialBoxData.centerZ + deltaLocal.z;
    } else if (cornerIndex >= 100 && cornerIndex <= 103) {
      // Dragging edge midpoint - adjust dimension and center
      // Screen coordinates in 2D view directly correspond to box local coordinates
      const edgeIndex = cornerIndex - 100;

      // Get the box's rotation matrix for transforming center offset to world coordinates
      const boxRotation = new THREE.Euler(
        initialBoxData.rotationX,
        initialBoxData.rotationY,
        initialBoxData.rotationZ,
        'ZYX'
      );
      const boxRotMatrix = new THREE.Matrix4().makeRotationFromEuler(boxRotation);

      // Screen drag (dx, dy) directly maps to box local coordinate delta
      // Note: dy is already flipped when calculated (dy = -(e.offsetY - dragStartPos.y) / zoom)
      // The 2D view displays box local coordinates, so screen motion directly corresponds to local motion
      let deltaLocal = new THREE.Vector3();

      if (viewType === 'top') {
        // Top view shows local XY plane: dx->local X, dy->local Y
        deltaLocal.set(dx, dy, 0);
      } else if (viewType === 'front') {
        // Front view shows local XZ plane: dx->local X, dy->local Z
        deltaLocal.set(dx, 0, dy);
      } else { // side
        // Side view shows local YZ plane: dx->local Y, dy->local Z
        deltaLocal.set(0, dx, dy);
      }

      // deltaLocal is already in box local coordinates (local X, Y, Z)
      // Dimension mapping: localSizeX->X-axis, localSizeY->Y-axis, localSizeZ->Z-axis
      // Determine which dimension to modify based on edge index
      let dimensionChange = 0;
      let centerOffsetLocal = new THREE.Vector3(0, 0, 0);

      if (viewType === 'top') {
        // In top view (XY plane), edges are:
        // Edge 0: corners 0-1, along X direction (Y- side)
        // Edge 1: corners 1-2, along Y direction (X+ side)
        // Edge 2: corners 2-3, along X direction (Y+ side)
        // Edge 3: corners 3-0, along Y direction (X- side)
        // Local axes: X=localSizeX, Y=localSizeY
        if (edgeIndex === 0) {
          // Edge along X direction (Y- side) - drag perpendicular (Y direction)
          dimensionChange = -deltaLocal.y;
          box.localSizeY = Math.max(0.01, initialBoxData.localSizeY + dimensionChange);
          // Center offset based on actual dimension change (accounts for clamping)
          const actualDimensionChange = box.localSizeY - initialBoxData.localSizeY;
          centerOffsetLocal.y = -actualDimensionChange / 2;
        } else if (edgeIndex === 1) {
          // Edge along Y direction (X+ side) - drag perpendicular (X direction)
          dimensionChange = deltaLocal.x;
          box.localSizeX = Math.max(0.01, initialBoxData.localSizeX + dimensionChange);
          const actualDimensionChange = box.localSizeX - initialBoxData.localSizeX;
          centerOffsetLocal.x = actualDimensionChange / 2;
        } else if (edgeIndex === 2) {
          // Edge along X direction (Y+ side) - drag perpendicular (Y direction)
          dimensionChange = deltaLocal.y;
          box.localSizeY = Math.max(0.01, initialBoxData.localSizeY + dimensionChange);
          const actualDimensionChange = box.localSizeY - initialBoxData.localSizeY;
          centerOffsetLocal.y = actualDimensionChange / 2;
        } else {
          // Edge along Y direction (X- side) - drag perpendicular (X direction)
          dimensionChange = -deltaLocal.x;
          box.localSizeX = Math.max(0.01, initialBoxData.localSizeX + dimensionChange);
          const actualDimensionChange = box.localSizeX - initialBoxData.localSizeX;
          centerOffsetLocal.x = -actualDimensionChange / 2;
        }
      } else if (viewType === 'front') {
        // In front view (XZ plane), edges are:
        // Edge 0: corners 0-1, along X direction (Z- side)
        // Edge 1: corners 1-5, along Z direction (X+ side)
        // Edge 2: corners 4-5, along X direction (Z+ side)
        // Edge 3: corners 0-4, along Z direction (X- side)
        // Local axes: X=localSizeX, Z=localSizeZ
        if (edgeIndex === 0) {
          // Edge along X direction (Z- side) - drag perpendicular (Z direction)
          dimensionChange = -deltaLocal.z;
          box.localSizeZ = Math.max(0.01, initialBoxData.localSizeZ + dimensionChange);
          const actualDimensionChange = box.localSizeZ - initialBoxData.localSizeZ;
          centerOffsetLocal.z = -actualDimensionChange / 2;
        } else if (edgeIndex === 1) {
          // Edge along Z direction (X+ side) - drag perpendicular (X direction)
          dimensionChange = deltaLocal.x;
          box.localSizeX = Math.max(0.01, initialBoxData.localSizeX + dimensionChange);
          const actualDimensionChange = box.localSizeX - initialBoxData.localSizeX;
          centerOffsetLocal.x = actualDimensionChange / 2;
        } else if (edgeIndex === 2) {
          // Edge along X direction (Z+ side) - drag perpendicular (Z direction)
          dimensionChange = deltaLocal.z;
          box.localSizeZ = Math.max(0.01, initialBoxData.localSizeZ + dimensionChange);
          const actualDimensionChange = box.localSizeZ - initialBoxData.localSizeZ;
          centerOffsetLocal.z = actualDimensionChange / 2;
        } else {
          // Edge along Z direction (X- side) - drag perpendicular (X direction)
          dimensionChange = -deltaLocal.x;
          box.localSizeX = Math.max(0.01, initialBoxData.localSizeX + dimensionChange);
          const actualDimensionChange = box.localSizeX - initialBoxData.localSizeX;
          centerOffsetLocal.x = -actualDimensionChange / 2;
        }
      } else { // side
        // In side view (YZ plane), edges are:
        // Edge 0: corners 0-3, along Y direction (Z- side)
        // Edge 1: corners 3-7, along Z direction (Y+ side)
        // Edge 2: corners 4-7, along Y direction (Z+ side)
        // Edge 3: corners 0-4, along Z direction (Y- side)
        // Local axes: Y=localSizeY, Z=localSizeZ
        if (edgeIndex === 0) {
          // Edge along Y direction (Z- side) - drag perpendicular (Z direction)
          dimensionChange = -deltaLocal.z;
          box.localSizeZ = Math.max(0.01, initialBoxData.localSizeZ + dimensionChange);
          const actualDimensionChange = box.localSizeZ - initialBoxData.localSizeZ;
          centerOffsetLocal.z = -actualDimensionChange / 2;
        } else if (edgeIndex === 1) {
          // Edge along Z direction (Y+ side) - drag perpendicular (Y direction)
          dimensionChange = deltaLocal.y;
          box.localSizeY = Math.max(0.01, initialBoxData.localSizeY + dimensionChange);
          const actualDimensionChange = box.localSizeY - initialBoxData.localSizeY;
          centerOffsetLocal.y = actualDimensionChange / 2;
        } else if (edgeIndex === 2) {
          // Edge along Y direction (Z+ side) - drag perpendicular (Z direction)
          dimensionChange = deltaLocal.z;
          box.localSizeZ = Math.max(0.01, initialBoxData.localSizeZ + dimensionChange);
          const actualDimensionChange = box.localSizeZ - initialBoxData.localSizeZ;
          centerOffsetLocal.z = actualDimensionChange / 2;
        } else {
          // Edge along Z direction (Y- side) - drag perpendicular (Y direction)
          dimensionChange = -deltaLocal.y;
          box.localSizeY = Math.max(0.01, initialBoxData.localSizeY + dimensionChange);
          const actualDimensionChange = box.localSizeY - initialBoxData.localSizeY;
          centerOffsetLocal.y = -actualDimensionChange / 2;
        }
      }

      // Transform center offset from local to world coordinates
      centerOffsetLocal.applyMatrix4(boxRotMatrix);

      // Update world center position
      box.centerX = initialBoxData.centerX + centerOffsetLocal.x;
      box.centerY = initialBoxData.centerY + centerOffsetLocal.y;
      box.centerZ = initialBoxData.centerZ + centerOffsetLocal.z;
    } else if (cornerIndex >= 0 && cornerIndex <= 7) {
      // Dragging corner - rotate around box's local axis
      // Strategy: Use precise matrix multiplication for 3D rotation,
      // but store angleDelta separately for 2D display to match mouse exactly

      // Get initial rotation matrix (use stored matrix for precision)
      const currentRotMatrix = initialBoxData.rotationMatrix.clone();

      // Create delta rotation in local space
      // IMPORTANT: Apply same transformations to both 3D rotation and 2D display angle
      let deltaRotation: THREE.Euler;
      if (viewType === 'top') {
        // Rotate around local Z axis
        deltaRotation = new THREE.Euler(0, 0, angleDelta, 'ZYX');
        this.currentDraggingAngleDelta = angleDelta;  // Same as 3D
      } else if (viewType === 'front') {
        // Rotate around local Y axis
        // Negate angle because viewing direction reverses rotation direction
        deltaRotation = new THREE.Euler(0, -angleDelta, 0, 'ZYX');
        this.currentDraggingAngleDelta = -angleDelta;  // Same negation as 3D
      } else { // side
        // Rotate around local X axis
        deltaRotation = new THREE.Euler(angleDelta, 0, 0, 'ZYX');
        this.currentDraggingAngleDelta = angleDelta;  // Same as 3D
      }
      const deltaRotMatrix = new THREE.Matrix4().makeRotationFromEuler(deltaRotation);

      // Multiply: newRot = currentRot × deltaRot (right multiply for local space)
      const newRotMatrix = new THREE.Matrix4().multiplyMatrices(currentRotMatrix, deltaRotMatrix);

      // Store precise rotation matrix
      box.rotationMatrix = newRotMatrix.clone();

      // Extract Euler angles for UI display (may be imprecise due to gimbal lock, but that's OK)
      const newRotation = new THREE.Euler().setFromRotationMatrix(newRotMatrix, 'ZYX');
      box.rotationX = newRotation.x;
      box.rotationY = newRotation.y;
      box.rotationZ = newRotation.z;

      // Update OTHER views' reference coordinate systems to the new rotation
      // This makes box appear axis-aligned in other 2D views while point cloud rotates
      // Keep the current view's reference fixed so point cloud stays fixed in that view
      if (viewType !== 'top') {
        this.topViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
        this.topViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
      }
      if (viewType !== 'front') {
        this.frontViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
        this.frontViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
      }
      if (viewType !== 'side') {
        this.sideViewInitialRotation = { x: box.rotationX, y: box.rotationY, z: box.rotationZ };
        this.sideViewInitialCenter = { x: box.centerX, y: box.centerY, z: box.centerZ };
      }
    }

    // Update 3D view and property panel
    this.updateBoundingBox();
  }
}