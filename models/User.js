const db = require('../config/db');

class User {
  constructor(data = {}) {
    this.id = data.id || data._id;
    this.name = data.name;
    this.email = data.email;
    this.password = data.password;
    this.date = data.date || new Date();
  }

  static findOne(query) {
    return new Promise((resolve, reject) => {
      if (!query) return resolve(null);

      let sql = '';
      let param = null;

      if (query.email) {
        sql = 'SELECT * FROM users WHERE email = ?';
        param = query.email;
      } else if (query.id || query._id) {
        sql = 'SELECT * FROM users WHERE id = ?';
        param = query.id || query._id;
      } else {
        return resolve(null);
      }

      db.get(sql, [param], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        return resolve(new User(row));
      });
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        return resolve(new User(row));
      });
    });
  }

  save() {
    return new Promise((resolve, reject) => {
      if (this.id) {
        db.run(
          'UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?',
          [this.name, this.email, this.password, this.id],
          function(err) {
            if (err) return reject(err);
            resolve(this);
          }
        );
      } else {
        const self = this;
        db.run(
          'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
          [this.name, this.email, this.password],
          function(err) {
            if (err) return reject(err);
            self.id = this.lastID;
            resolve(self);
          }
        );
      }
    });
  }
}

module.exports = User;
