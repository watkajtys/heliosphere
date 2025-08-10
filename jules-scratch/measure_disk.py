from PIL import Image

def measure_occulting_disk(image_path):
    """
    Measures the diameter of the black occulting disk in an image.
    Assumes the disk is centered and the background is not pure black.
    """
    with Image.open(image_path) as img:
        width, height = img.size
        center_x, center_y = width // 2, height // 2

        # Scan horizontally from center to the right
        right_edge = center_x
        for x in range(center_x, width):
            pixel = img.getpixel((x, center_y))
            # Check if pixel is black (or very close to it), ignoring alpha
            if sum(pixel[:3]) > 10: # Allow for some noise
                right_edge = x
                break

        # Scan horizontally from center to the left
        left_edge = center_x
        for x in range(center_x, 0, -1):
            pixel = img.getpixel((x, center_y))
            if sum(pixel[:3]) > 10:
                left_edge = x
                break

        diameter = right_edge - left_edge
        return diameter

if __name__ == "__main__":
    corona_image_path = "jules-scratch/corona_sample.png"
    disk_diameter = measure_occulting_disk(corona_image_path)
    print(f"The estimated diameter of the occulting disk is: {disk_diameter} pixels")
