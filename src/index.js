import fs from 'fs';
import path from 'path';
import objectAssign from 'object-assign';
import { Connection } from 'jsforce';
import glob from 'glob';
import { union } from 'lodash';
import Zip from 'node-zip';

const defaultOptions = {
  salesforce: {
    username: null,
    password: null,
    token: '',
    loginUrl: 'https://login.salesforce.com'
  },
  resources: []
};

class WebpackSalesforcePlugin {
  constructor(options = {}) {
    this.options = objectAssign({}, options);
    this.options.salesforce = objectAssign({}, defaultOptions.salesforce, options.salesforce);
    this.options.resources = options.resources || defaultOptions.resources;

    if (!this.options.salesforce.username) {
      throw new Error('salesforce.username is required.');
    }

    if (!this.options.salesforce.password) {
      throw new Error('salesforce.password is required.');
    }

    this.options.resources.forEach((resource) => {
      if (!resource.name) {
        throw new Error('Resource name is required.');
      }
    });

    this.conn = new Connection({ loginUrl: this.options.salesforce.loginUrl });
  }

  apply(compiler) {
    compiler.plugin('after-emit', async (compilation, done) => {
      const resources = this.__globFiles().map((resource) => this.__zipResource(resource));
      try {
        await this.login();
        await this.upload(resources);
        console.log('Upload complated!');
        done();
      } catch (e) {
        done(e);
      }
    });
  }

  login() {
    console.log('Logging in to Salesforce.');
    const promise = new Promise((resolve, reject) => {
      const { username, password, token = '' } = this.options.salesforce;
      this.conn.login(username, `${password}${token}`, (err, res) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to Salesforce.');
          resolve(true);
        }
      });
    });

    return promise;
  }

  upload(resources) {
    console.log('Uploading resources.');
    const promise = new Promise((resolve, reject) => {
      this.conn.metadata.upsert('StaticResource', resources, (err, results) => {
        if (err) {
          reject(err);

          return;
        }

        if (!results) {
          reject(new Error('Upload resources failed. (No results)'));
        } else if (toString.apply(results) === '[object Object]') {
          if (results.success) {
            resolve(true);
          } else {
            reject(results);
          }
        } else if (toString.apply(results) === '[object Array]') {
          const errors = results.filter((r) => !r.success);
          errors.forEach((r) => console.error(r))
          if (errors.length > 0) {
            reject(new Error('Upload resources failed. (With errors)'));
          }

          resolve(true);
        }
      });
    });

    return promise;
  }

  __zipResource(globbedResource) {
    if (globbedResource.files.length === 0) {
      throw new Error('Resource ' + globbedResource.name + ' matched no files.');
    }

    const zip = new Zip();
    globbedResource.files.forEach((f) => {
      if (this.options.debug) {
        console.info('file', f);
      }

      let data = null;
      if (f.path.match(/.*?woff(2?)$/)) {
        data = fs.readFileSync(f.path);
      } else if (f.path.match(/(png|jpg|jpeg|gif)$/)) {
        data = fs.readFileSync(f.path);
      } else {
        data = fs.readFileSync(f.path, 'utf8');
      }

      zip.file(f.pathInZip, data);
    });

    if (this.options.debug) {
      const data = zip.generate({ base64: false, compression: 'DEFLATE' });
      fs.writeFileSync(path.resolve('./temp.zip'), data, 'binary');
    }

    const result = {
      fullName: globbedResource.name,
      content: zip.generate({ base64: true, compression: 'DEFLATE' }),
      contentType: 'application/zip'
    };

    return result;
  }

  __globFiles() {
    return this.options.resources.map((resource) => {
      const filesToZip = resource.files.map((fileGlob) => {
        return glob.sync(fileGlob, {}).map((file) => {
          const info = {
            path: file,
          };

          if (resource.basePath && file.indexOf(resource.basePath) === 0) {
            info.pathInZip = file.replace(resource.basePath, '');
          } else {
            info.pathInZip = file;
          }

          return info;
        });
      }).reduce((currentList, nextList) => {
        return union(currentList, nextList);
      }, []);

      const result = {
        name: resource.name,
        files: filesToZip
      };

      return result;
    });
  }
}

module.exports = WebpackSalesforcePlugin;
