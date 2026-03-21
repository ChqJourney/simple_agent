export interface InternalDraggedFileDescriptor {
  path: string;
  name?: string;
  isDirectory?: boolean;
  isImage?: boolean;
}

let activeDraggedFileDescriptors: InternalDraggedFileDescriptor[] = [];

export function setActiveDraggedFileDescriptors(descriptors: InternalDraggedFileDescriptor[]): void {
  activeDraggedFileDescriptors = descriptors;
}

export function getActiveDraggedFileDescriptors(): InternalDraggedFileDescriptor[] {
  return activeDraggedFileDescriptors;
}

export function clearActiveDraggedFileDescriptors(): void {
  activeDraggedFileDescriptors = [];
}
