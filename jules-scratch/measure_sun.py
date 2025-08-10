from PIL import Image

def measure_sun_disk(image_path):
    """
    Measures the diameter of the sun disk in an image.
    Assumes the sun is centered and the background is black.
    """
    with Image.open(image_path) as img:
        # Convert to grayscale to simplify pixel value checking
        img = img.convert('L')
        width, height = img.size
        center_y = height // 2

        # Scan from left edge to the right to find the first bright pixel
        left_edge = 0
        for x in range(width):
            pixel_brightness = img.getpixel((x, center_y))
            if pixel_brightness > 20: # Threshold for brightness
                left_edge = x
                break

        # Scan from right edge to the left to find the first bright pixel
        right_edge = width -1
        for x in range(width - 1, 0, -1):
            pixel_brightness = img.getpixel((x, center_y))
            if pixel_brightness > 20:
                right_edge = x
                break

        diameter = right_edge - left_edge
        return diameter

if __name__ == "__main__":
    sun_image_path = "jules-scratch/sundisk_sample.png"
    sun_diameter = measure_sun_disk(sun_image_path)
    print(f"The estimated diameter of the sun disk is: {sun_diameter} pixels")
