import os
import mimetypes

import boto3
from fabric import task


ROGUE_PATH = os.path.join(os.path.dirname(__file__))
ROGUE_WEB_PATH = os.path.join(ROGUE_PATH, "web")
ROGUE_BUILD_PATH = os.path.join(ROGUE_WEB_PATH, "build")
ROGUE_WEB_HOST = "rogue.quuux.org"


def deploy_website(path, bucket_name):
    s3 = boto3.client('s3')

    def upload(dirname, filename):

        if filename[0] == "." or not os.path.isfile(os.path.join(dirname, filename)):
            return

        local_path = os.path.join(dirname, filename)
        remote_path = local_path[len(path) + 1:]

        mimetype, encoding = mimetypes.guess_type(local_path)

        print(local_path, '->', remote_path, mimetype, encoding)
        with open(local_path) as f:
            s3.put_object(
                Body=f.read(),
                Bucket=bucket_name,
                ACL="public-read",
                Key=remote_path,
                ContentType=mimetype or "text/plain",
            )

    for dirname, _, filenames in os.walk(path):
        for filename in filenames:
            upload(dirname, filename)


@task
def build_web(c):
    with c.cd(ROGUE_WEB_PATH):
        c.run("PATH=\"$PATH:/usr/local/bin\" yarn build")


@task
def deploy_web(_):
    deploy_website(ROGUE_BUILD_PATH, ROGUE_WEB_HOST)
