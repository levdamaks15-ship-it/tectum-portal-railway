import os
import boto3
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv()

# Cloudflare R2 Credentials
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "26d41b2dface00b1159e5f6045e32047")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "33838fe36a3fdb3f2397fd52bfaeef16")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "f3f49f54c07109ddfe8e3c04ff36197c98c22a430cc5f056cbc77ff903115caf")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "tectum-docs")
R2_ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

_s3_client = None

def get_r2_client():
    global _s3_client
    if _s3_client is not None:
        return _s3_client

    _s3_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto"
    )
    return _s3_client

def generate_presigned_upload_url(object_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600) -> str:
    """
    Generates a secure, temporary Direct-to-S3 pre-signed PUT URL.
    The browser uploads the file directly to Cloudflare R2 in milliseconds!
    """
    client = get_r2_client()
    url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": R2_BUCKET_NAME,
            "Key": object_key,
            "ContentType": content_type
        },
        ExpiresIn=expires_in
    )
    return url

def generate_presigned_download_url(object_key: str, expires_in: int = 86400) -> str:
    """
    Generates a temporary direct download/view URL for a file in R2.
    """
    client = get_r2_client()
    url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": R2_BUCKET_NAME,
            "Key": object_key
        },
        ExpiresIn=expires_in
    )
    return url

def delete_r2_file(object_key: str):
    """Deletes an object from Cloudflare R2"""
    try:
        client = get_r2_client()
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=object_key)
    except Exception as e:
        print(f"Error deleting R2 object {object_key}: {e}")
