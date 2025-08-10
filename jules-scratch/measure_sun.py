from PIL import Image
import numpy as np

def measure_sun_disk(image_path):
    """
    Measures the diameter of the sun disk in an image using a gradient-based approach.
    This method is more robust against fainter outer layers like the corona or flares.
    Assumes the sun is centered.
    """
    with Image.open(image_path) as img:
        # Convert to grayscale to work with brightness values
        img = img.convert('L')
        width, height = img.size
        center_y = height // 2

        # Extract pixel brightness along the horizontal centerline
        pixels = [img.getpixel((x, center_y)) for x in range(width)]
        pixels_array = np.array(pixels)

        # Calculate the gradient of the brightness profile
        gradient = np.gradient(pixels_array)

        # The edge of the sun disk corresponds to the sharpest change in brightness,
        # which means the maximum and minimum points of the gradient.
        left_edge = np.argmax(gradient)
        right_edge = np.argmin(gradient)

        diameter = right_edge - left_edge
        return diameter

if __name__ == "__main__":
    sun_image_path = "jules-scratch/sundisk_sample.png"
    sun_diameter = measure_sun_disk(sun_image_path)
    print(f"The estimated diameter of the sun disk is: {sun_diameter} pixels")
