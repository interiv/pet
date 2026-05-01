const express = require('express');
const app = express();

const adminRouter = express.Router();

adminRouter.get('/classes', (req, res) => res.json({ route: 'classes' }));
adminRouter.post('/classes/:id/teachers', (req, res) => res.json({ route: 'add-teacher' }));
adminRouter.delete('/classes/:id/teachers/:teacherId', (req, res) => res.json({ route: 'remove-teacher' }));
adminRouter.put('/classes/:id', (req, res) => res.json({ route: 'update-class' }));
adminRouter.delete('/classes/:id', (req, res) => res.json({ route: 'delete-class' }));
adminRouter.get('/classes/:id/teacher-activity', (req, res) => res.json({ route: 'teacher-activity', classId: req.params.id }));

app.use('/api/admin', adminRouter);

app.use((req, res) => res.status(404).json({ error: '未找到请求的资源' }));

const server = app.listen(3999, () => {
  console.log('Test server on 3999');
  
  const http = require('http');
  function test(path) {
    return new Promise(resolve => {
      http.get(`http://localhost:3999${path}`, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          console.log(`[${res.statusCode}] ${path} => ${data}`);
          resolve();
        });
      });
    });
  }
  
  (async () => {
    await test('/api/admin/classes');
    await test('/api/admin/classes/2');
    await test('/api/admin/classes/2/teacher-activity');
    await test('/api/admin/classes/2/teachers');
    server.close();
  })();
});
