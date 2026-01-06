# Dummy MessageBox implementation for BLE Scanner
# Si no encuentras messagebox.pri original

#ifndef MESSAGEBOX_DUMMY_H
#define MESSAGEBOX_DUMMY_H

#include <QWidget>
#include <QMessageBox>

enum SA_TYPE {
    SA_OKS,
    SA_WARNING,
    SA_TIPS,
    SA_SUCCESS
};

class MessageBox : public QMessageBox
{
    Q_OBJECT

public:
    explicit MessageBox(QWidget *parent = nullptr, SA_TYPE okType = SA_OKS, SA_TYPE msgType = SA_TIPS);
    
    void SetTips(const QString &tips) {
        setText(tips);
    }
    
private:
    SA_TYPE m_okType;
    SA_TYPE m_msgType;
};

#endif // MESSAGEBOX_DUMMY_H