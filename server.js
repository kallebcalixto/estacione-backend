const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Configuração do CORS para permitir que seu site fale com o servidor
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO FIREBASE ADMIN ---
const serviceAccount = require("./samir-calixto-firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://estacione-6cfbf-default-rtdb.firebaseio.com"
});
const db = admin.database();

// --- 2. CONFIGURAÇÃO DO MERCADO PAGO ---
// Puxa o token das variáveis de ambiente do Render para sua segurança
const mpClient = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN 
});
const payment = new Payment(mpClient);

// --- 3. ROTA PARA CRIAR O PIX ---
app.post('/criar-pix', async (req, res) => {
    try {
        const { valor, email, userId } = req.body;

        const body = {
            transaction_amount: parseFloat(valor),
            description: 'Recarga Estacione Colombo',
            payment_method_id: 'pix',
            payer: { email: email },
            // URL que o Mercado Pago vai avisar quando o cliente pagar
            notification_url: "https://estacione-backend.onrender.com/webhook"
        };

        const response = await payment.create({ body });
        
        // Envia os dados do PIX de volta para o seu site
        res.json({ 
            copyPaste: response.point_of_interaction.transaction_data.qr_code,
            qrCode: response.point_of_interaction.transaction_data.qr_code_base64
        });
    } catch (error) {
        console.error("Erro ao criar PIX:", error);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// --- 4. WEBHOOK (Onde o Mercado Pago avisa que o pagamento caiu) ---
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;

    if (action === "payment.created" || req.body.type === "payment") {
        const paymentId = data?.id || req.body.data?.id;

        try {
            const pagamento = await payment.get({ id: paymentId });

            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                const emailCliente = pagamento.payer.email;

                const usersRef = db.ref('usuarios');
                const snapshot = await usersRef.orderByChild('email').equalTo(emailCliente).once('value');

                if (snapshot.exists()) {
                    const userId = Object.keys(snapshot.val())[0];
                    const userDados = snapshot.val()[userId];
                    const novoSaldo = (userDados.saldo || 0) + valorPago;

                    // Atualiza o saldo no Firebase
                    await usersRef.child(userId).update({ saldo: novoSaldo });
                    console.log(`✅ Saldo creditado: R$ ${valorPago} para ${emailCliente}`);
                }
            }
        } catch (e) {
            console.error("Erro ao processar pagamento no webhook:", e);
        }
    }
    res.sendStatus(200); 
});

// Rota de teste para ver se o servidor está online
app.get('/', (req, res) => res.send('Servidor Estacione Colombo: ONLINE ✅'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
