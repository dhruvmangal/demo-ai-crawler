import express from 'express';

const app = express();
const PORT = 4000;

// Shared Layout template
const layout = (title: string, body: string, breadcrumb: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; display: flex; margin: 0; }
    aside { width: 250px; background: #2c3e50; color: white; padding: 20px; height: 100vh; }
    aside a { color: white; text-decoration: none; display: block; padding: 10px 0; }
    main { flex: 1; padding: 40px; }
    nav.breadcrumbs { font-size: 14px; color: #7f8c8d; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #bdc3c7; padding: 12px; text-align: left; }
    th { background: #ecf0f1; }
    .btn { background: #3498db; color: white; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px; }
    .btn-danger { background: #e74c3c; }
    .modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border: 1px solid #ccc; padding: 30px; box-shadow: 0 0 10px rgba(0,0,0,0.5); z-index: 1000; }
    .modal.active { display: block; }
  </style>
</head>
<body>
  <aside>
    <h2>Mock CRM</h2>
    <a href="/dashboard">Dashboard</a>
    <a href="/customers">Customers</a>
    <a href="/orders">Orders</a>
    <a href="/settings">Settings</a>
  </aside>
  <main>
    <nav class="breadcrumbs" aria-label="breadcrumb">
      <li><a href="/dashboard">Home</a></li>
      <li>${breadcrumb}</li>
    </nav>
    ${body}
  </main>
  <script>
    function openModal() {
      document.getElementById('modalForm').classList.add('active');
    }
    function closeModal() {
      document.getElementById('modalForm').classList.remove('active');
    }
  </script>
</body>
</html>
`;

app.get('/dashboard', (req, res) => {
  res.send(layout(
    'Dashboard Overview',
    `<h1>Dashboard</h1>
     <p>Welcome back! You have 10 new notifications.</p>
     <button class="btn" onclick="openModal()">Add Lead</button>
     
     <div id="modalForm" class="modal">
       <h3>Create Lead Form</h3>
       <form action="/leads" method="POST">
         <label for="lead_name">Lead Name</label>
         <input type="text" id="lead_name" name="lead_name" required placeholder="John Doe">
         
         <label for="lead_email">Email</label>
         <input type="email" id="lead_email" name="lead_email" required>
         
         <button type="submit" class="btn">Create</button>
         <button type="button" onclick="closeModal()">Cancel</button>
       </form>
     </div>
    `,
    'Dashboard'
  ));
});

app.get('/customers', (req, res) => {
  res.send(layout(
    'Customer Management',
    `<h1>Customers</h1>
     <button class="btn" onclick="openModal()">Create Customer</button>
     
     <div id="modalForm" class="modal">
       <h3>Create Customer Form</h3>
       <form action="/customers" method="POST">
         <label for="customer_name">Customer Name</label>
         <input type="text" id="customer_name" name="customer_name" required>
         
         <label for="customer_email">Email</label>
         <input type="email" id="customer_email" name="customer_email" required>
         
         <button type="submit" class="btn">Create</button>
         <button type="button" onclick="closeModal()">Cancel</button>
       </form>
     </div>

     <table class="table" aria-label="Customer Table">
       <thead>
         <tr>
           <th>Customer Name</th>
           <th>Email</th>
           <th>Status</th>
           <th>Actions</th>
         </tr>
       </thead>
       <tbody>
         <tr>
           <td>Alice Cooper</td>
           <td>alice@cooper.com</td>
           <td>Active</td>
           <td>
             <button class="btn">Edit</button>
             <button class="btn btn-danger">Delete</button>
           </td>
         </tr>
       </tbody>
     </table>
    `,
    'Customers'
  ));
});

app.get('/orders', (req, res) => {
  res.send(layout(
    'Order Management',
    `<h1>Orders</h1>
     <button class="btn" onclick="openModal()">Create Order</button>

     <div id="modalForm" class="modal">
       <h3>Create Order Form</h3>
       <form action="/orders" method="POST">
         <label for="customer_id">Customer Reference</label>
         <input type="text" id="customer_id" name="customer_id" required>
         
         <label for="amount">Total Amount</label>
         <input type="number" id="amount" name="amount" required>
         
         <button type="submit" class="btn">Create</button>
         <button type="button" onclick="closeModal()">Cancel</button>
       </form>
     </div>

     <table class="table" aria-label="Order Table">
       <thead>
         <tr>
           <th>Order ID</th>
           <th>Customer Name</th>
           <th>Amount</th>
           <th>Actions</th>
         </tr>
       </thead>
       <tbody>
         <tr>
           <td>ORD-001</td>
           <td>Alice Cooper</td>
           <td>$150.00</td>
           <td>
             <button class="btn">Print Invoice</button>
             <button class="btn btn-danger">Refund</button>
           </td>
         </tr>
       </tbody>
     </table>
    `,
    'Orders'
  ));
});

app.get('/settings', (req, res) => {
  res.send(layout(
    'System Settings',
    `<h1>Settings</h1>
     <p>System settings profile configure options.</p>
    `,
    'Settings'
  ));
});

// --- Login-gated area, for exercising the crawler's login-wall handling ---
const isLoggedIn = (req: express.Request): boolean => (req.headers.cookie || '').includes('session=valid');

app.get('/portal', (req, res) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  res.send(layout(
    'Secure Portal',
    `<h1>Secure Portal</h1><p>Welcome back, authenticated user.</p>`,
    'Portal'
  ));
});

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>Login</title></head>
    <body>
      <h2>Sign In</h2>
      <form action="/login" method="POST">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
        <button type="submit">Sign In</button>
      </form>
    </body>
    </html>
  `);
});

app.use(express.urlencoded({ extended: true }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    res.setHeader('Set-Cookie', 'session=valid; Path=/');
    return res.redirect('/portal');
  }
  res.status(401).send('Invalid credentials. <a href="/login">Try again</a>');
});

export const mockServer = app.listen(PORT, () => {
  console.log(`Mock CRM Target App running on http://localhost:${PORT}`);
});
