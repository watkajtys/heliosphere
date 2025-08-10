from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Give the server a moment to respond
        try:
            page.goto("http://localhost:3000/?date=2023-01-01T00:00:00Z", timeout=10000)
            # Wait for the image to be loaded if it's an image tag
            # In our case, the response is the image itself, so no need to wait for a selector
            page.screenshot(path="jules-scratch/verification/verification.png")
        except Exception as e:
            print(f"An error occurred: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
