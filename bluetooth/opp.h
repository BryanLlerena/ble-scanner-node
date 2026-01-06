#ifndef OPP_H
#define OPP_H

#include <QWidget>
#include <QTimer>
#include "gap.h"
#include "../messagebox/messagebox.h"

namespace Ui {
class opp;
}

class opp : public QWidget
{
    Q_OBJECT

public:
    explicit opp(QWidget *parent = 0);
    ~opp();

public slots:
        void sendBt_enable(bool sta);
        void receiveBt_enable(bool sta);

private slots:
    void on_search_clicked();

    void on_send_clicked();

    void on_receive_clicked();

    void timerTimeOut();

    void on_close_clicked();

private:
    Ui::opp *ui;
    QTimer *timer;

    void showWarningMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_WARNING);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }
    void showInformationMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_TIPS);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }

    void showSuccessfulMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_SUCCESS);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }

signals:
    void btsend(QString);
};


#endif // OPP_H
